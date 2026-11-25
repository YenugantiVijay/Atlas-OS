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
  syncStartedAt?: number;
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
export const SYNCED_PRUNE_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

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

export function pruneOldSynced(
  queue: QueuedOfflineAction[],
  maxAgeMs: number = SYNCED_PRUNE_RETENTION_MS
): QueuedOfflineAction[] {
  const now = Date.now();
  return queue.filter((item) => {
    if (item.status !== 'synced') return true;
    const syncedTime = item.syncedAt
      ? new Date(item.syncedAt).getTime()
      : item.createdAt
      ? new Date(item.createdAt).getTime()
      : 0;
    return now - syncedTime < maxAgeMs;
  });
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
  // 1. Proactively prune synced actions older than retention period
  const prunedQueue = pruneOldSynced(queue);

  try {
    localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(prunedQueue));
    notifyOfflineQueueChanged();
  } catch (err: any) {
    const isQuotaError =
      err &&
      (err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.code === 22 ||
        err.code === 1014 ||
        String(err).toLowerCase().includes('quota'));

    if (isQuotaError) {
      // Emergency recovery: immediately prune all synced items regardless of age to free immediate space
      const emergencyQueue = prunedQueue.filter((item) => item.status !== 'synced');
      try {
        localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(emergencyQueue));
        notifyOfflineQueueChanged();
        console.warn(
          'Atlas OS offline storage quota reached: purged completed transactions to preserve pending offline data.'
        );
        return;
      } catch (retryErr) {
        throw new Error(
          `Device storage quota exceeded: Unable to safely store offline transactions even after purging completed records. Please clear browser storage or connect to the internet to sync pending transactions.`
        );
      }
    }

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
    const queue = pruneOldSynced(loadQueue());
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

  /** Process a workspace queue exclusively while recovering interrupted requests. */
  async processQueue(
    organizationId: string,
    handler: (action: QueuedOfflineAction) => Promise<void>
  ): Promise<SyncProcessResult> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (locks) {
      return locks.request(OFFLINE_QUEUE_STORAGE_KEY, () => processActions(organizationId, handler, true));
    }
    if (syncInProgress) {
      return { processed: 0, succeeded: 0, failed: 0, pendingRemaining: this.getSummary(organizationId).pending };
    }
    syncInProgress = true;
    try {
      return await processActions(organizationId, handler, false);
    } finally {
      syncInProgress = false;
    }
  },
};

let syncInProgress = false;
const INTERRUPTED_SYNC_TIMEOUT_MS = 5 * 60 * 1000;

async function processActions(
  organizationId: string,
  handler: (action: QueuedOfflineAction) => Promise<void>,
  holdsBrowserLock: boolean
): Promise<SyncProcessResult> {
  const canProcess = (item: QueuedOfflineAction) => item.status === 'pending' ||
    (item.status === 'syncing' &&
      (holdsBrowserLock || Date.now() - (item.syncStartedAt ?? 0) >= INTERRUPTED_SYNC_TIMEOUT_MS));
  const initialQueue = loadQueue();
  const pendingIds = initialQueue
    .filter((i) => i.organizationId === organizationId && canProcess(i))
    .map((i) => i.id);

  let succeeded = 0;
  let failed = 0;

  for (const actionId of pendingIds) {
    // 1. Reload freshest state and transition target action to 'syncing'
    const syncingQueue = loadQueue();
    const currentAction = syncingQueue.find(
      (i) => i.organizationId === organizationId && i.id === actionId && canProcess(i)
    );
    if (!currentAction) continue;

    currentAction.status = 'syncing';
    currentAction.syncStartedAt = Date.now();
    currentAction.attemptCount += 1;
    saveQueue(syncingQueue);

    try {
      await handler({ ...currentAction });

      // 2. Reload freshest state and transition target action to 'synced'
      const syncedQueue = loadQueue();
      const target = syncedQueue.find(
        (i) => i.organizationId === organizationId && i.id === actionId
      );
      if (target) {
        target.status = 'synced';
        target.syncedAt = new Date().toISOString();
        target.lastError = null;
        saveQueue(syncedQueue);
      }
      succeeded += 1;
    } catch (err: any) {
      // 3. Reload freshest state and transition target action to 'failed'
      const failedQueue = loadQueue();
      const target = failedQueue.find(
        (i) => i.organizationId === organizationId && i.id === actionId
      );
      if (target) {
        target.status = 'failed';
        target.lastError = err?.message || 'Unknown synchronization error';
        saveQueue(failedQueue);
      }
      failed += 1;
    }
  }

  const finalQueue = loadQueue().filter((i) => i.organizationId === organizationId);
  const pendingRemaining = finalQueue.filter(
    (i) => i.status === 'pending' || i.status === 'syncing'
  ).length;

  return {
    processed: pendingIds.length,
    succeeded,
    failed,
    pendingRemaining,
  };
}
