/**
 * ATLAS OS — Safe Offline Action Queue & Sync Recovery
 *
 * Stores pending actions for recovery and server-confirmed replay.
 * Actions are persisted to localStorage with request-level idempotency keys, FIFO sequencing,
 * retry counters, and explicit conflict resolution strategies.
 */

export type OfflineActionType =
  | 'CREATE_ORDER'
  | 'CONFIRM_ORDER'
  | 'CREATE_INVOICE'
  | 'RECORD_PAYMENT'
  | 'RECEIVE_GOODS'
  | 'ADJUST_STOCK'
  | 'CREATE_PRODUCT'
  | 'CREATE_CUSTOMER';

export type QueueActionStatus = 'pending' | 'syncing' | 'synced' | 'failed';
export type ConflictStrategy = 'client_wins' | 'server_wins' | 'manual';

export interface QueuedOfflineAction<T = any> {
  id: string;
  organizationId: string;
  actionType: OfflineActionType;
  description: string;
  payload: T;
  idempotencyKey: string;
  status: QueueActionStatus;
  createdAt: string;
  syncedAt?: string;
  attemptCount: number;
  lastError?: string | null;
  conflictStrategy: ConflictStrategy;
}

export interface SyncProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
  pendingRemaining: number;
}

const OFFLINE_QUEUE_STORAGE_KEY = 'atlas_offline_action_queue_v1';
export const OFFLINE_QUEUE_EVENT = 'atlas:offline-queue-changed';

export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('fetch failed') ||
    message.includes('network error') ||
    message.includes('offline') ||
    message.includes('ERR_CONNECTION_REFUSED') ||
    message.includes('ERR_INTERNET_DISCONNECTED')
  );
}

export function notifyOfflineQueueChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT));
    } catch {
      // Ignore if event dispatch fails in restricted environments
    }
  }
}

function loadQueue(): QueuedOfflineAction[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedOfflineAction[]): void {
  try {
    localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    notifyOfflineQueueChanged();
  } catch (err) {
    throw new Error(`Cannot safely save offline transactions on this device: ${String(err)}`);
  }
}

export const offlineQueue = {
  /**
   * Enqueues a new mutation action for deferred/offline sync.
   */
  enqueue<T = any>(
    organizationId: string,
    actionType: OfflineActionType,
    payload: T,
    options: {
      description?: string;
      idempotencyKey?: string;
      conflictStrategy?: ConflictStrategy;
    } = {}
  ): QueuedOfflineAction<T> {
    const queue = loadQueue();
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'offline-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const idempotencyKey = options.idempotencyKey || id;

    // Check for duplicate pending action with the same idempotency key
    const existing = queue.find(
      (item) => item.organizationId === organizationId && item.idempotencyKey === idempotencyKey && item.status !== 'synced'
    );
    if (existing) {
      return existing;
    }

    const newAction: QueuedOfflineAction<T> = {
      id,
      organizationId,
      actionType,
      description: options.description || `${actionType} on ${new Date().toLocaleTimeString()}`,
      payload,
      idempotencyKey,
      status: 'pending',
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      conflictStrategy: options.conflictStrategy || 'manual',
    };

    queue.push(newAction);
    saveQueue(queue);
    return newAction;
  },

  /**
   * Retrieves queued actions for one organization, or all when omitted.
   */
  getAll(organizationId?: string): QueuedOfflineAction[] {
    const queue = loadQueue();
    return organizationId === undefined
      ? queue
      : queue.filter((item) => item.organizationId === organizationId);
  },

  /**
   * Retrieves counts by status for badge indicators.
   */
  getSummary(organizationId: string): {
    total: number;
    pending: number;
    failed: number;
    synced: number;
  } {
    const items = this.getAll(organizationId);
    return {
      total: items.length,
      pending: items.filter((i) => i.status === 'pending' || i.status === 'syncing').length,
      failed: items.filter((i) => i.status === 'failed').length,
      synced: items.filter((i) => i.status === 'synced').length,
    };
  },

  /**
   * Removes a specific queued item (e.g. after manual discard or conflict resolution).
   */
  remove(organizationId: string, actionId: string): boolean {
    const queue = loadQueue();
    const filtered = queue.filter(
      (item) => !(item.organizationId === organizationId && item.id === actionId)
    );
    const changed = filtered.length !== queue.length;
    if (changed) {
      saveQueue(filtered);
    }
    return changed;
  },

  /**
   * Resets a failed item back to pending for retry.
   */
  retry(organizationId: string, actionId: string): boolean {
    const queue = loadQueue();
    const item = queue.find((i) => i.organizationId === organizationId && i.id === actionId);
    if (!item) return false;

    item.status = 'pending';
    item.lastError = null;
    saveQueue(queue);
    return true;
  },

  /**
   * Clears all successfully synced actions from the queue to free storage.
   */
  clearSynced(organizationId: string): number {
    const queue = loadQueue();
    const remaining = queue.filter(
      (item) => !(item.organizationId === organizationId && item.status === 'synced')
    );
    const count = queue.length - remaining.length;
    saveQueue(remaining);
    return count;
  },

  /**
   * Processes all pending items sequentially with a provided execution handler.
   */
  async processQueue(
    organizationId: string,
    handler: (action: QueuedOfflineAction) => Promise<void>
  ): Promise<SyncProcessResult> {
    const queue = loadQueue();
    const orgItems = queue.filter(
      (i) => i.organizationId === organizationId && i.status === 'pending'
    );

    let succeeded = 0;
    let failed = 0;

    for (const action of orgItems) {
      action.status = 'syncing';
      action.attemptCount += 1;
      saveQueue(queue);

      try {
        await handler(action);
        action.status = 'synced';
        action.syncedAt = new Date().toISOString();
        action.lastError = null;
        succeeded += 1;
      } catch (err: any) {
        action.status = 'failed';
        action.lastError = err?.message || 'Unknown synchronization error';
        failed += 1;
      }
      saveQueue(queue);
    }

    const finalQueue = loadQueue().filter((i) => i.organizationId === organizationId);
    const pendingRemaining = finalQueue.filter((i) => i.status === 'pending' || i.status === 'syncing').length;

    return {
      processed: orgItems.length,
      succeeded,
      failed,
      pendingRemaining,
    };
  },
};
