import { describe, it, expect, beforeEach } from 'vitest';
import { offlineQueue } from './offline-queue';

describe('Area 2: Mobile & Offline Action Queue & Sync Recovery', () => {
  const orgId = 'org-offline-01';

  beforeEach(() => {
    localStorage.clear();
  });

  it('enqueues actions with FIFO ordering and prevents duplicate idempotency keys', () => {
    const action1 = offlineQueue.enqueue(orgId, 'RECORD_PAYMENT', {
      amount: 1200,
      customerId: 'cust-1',
    }, { idempotencyKey: 'idem-key-01', description: 'Payment of ₹1,200' });

    expect(action1.status).toBe('pending');
    expect(action1.idempotencyKey).toBe('idem-key-01');

    // Duplicate enqueue with same key must return existing item without duplicating
    const actionDuplicate = offlineQueue.enqueue(orgId, 'RECORD_PAYMENT', {
      amount: 1200,
      customerId: 'cust-1',
    }, { idempotencyKey: 'idem-key-01' });

    expect(actionDuplicate.id).toBe(action1.id);
    expect(offlineQueue.getAll(orgId).length).toBe(1);

    // Enqueue second distinct action
    const action2 = offlineQueue.enqueue(orgId, 'CREATE_ORDER', {
      items: [{ sku: 'POL-2.5', qty: 5 }],
    }, { idempotencyKey: 'idem-key-02' });

    expect(action2.status).toBe('pending');
    expect(offlineQueue.getAll(orgId).length).toBe(2);
    expect(offlineQueue.getSummary(orgId).pending).toBe(2);
  });

  it('processes queued actions sequentially and captures failures with error reasons', async () => {
    offlineQueue.enqueue(orgId, 'CREATE_ORDER', { orderId: 'ord-1' });
    offlineQueue.enqueue(orgId, 'RECORD_PAYMENT', { paymentId: 'pay-fail' });
    offlineQueue.enqueue(orgId, 'ADJUST_STOCK', { sku: 'SKU-OK', qty: 10 });

    const executedActions: string[] = [];
    const result = await offlineQueue.processQueue(orgId, async (action) => {
      executedActions.push(action.actionType);
      if (action.payload.paymentId === 'pay-fail') {
        throw new Error('Customer credit limit exceeded on server');
      }
    });

    expect(result.processed).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(executedActions).toEqual(['CREATE_ORDER', 'RECORD_PAYMENT', 'ADJUST_STOCK']);

    const summary = offlineQueue.getSummary(orgId);
    expect(summary.synced).toBe(2);
    expect(summary.failed).toBe(1);

    const failedItem = offlineQueue.getAll(orgId).find((i) => i.status === 'failed');
    expect(failedItem?.lastError).toContain('Customer credit limit exceeded on server');
    expect(failedItem?.attemptCount).toBe(1);
  });

  it('supports retry on failed action and allows clearing synced items', async () => {
    const action = offlineQueue.enqueue(orgId, 'RECORD_PAYMENT', { id: 'fail-1' });
    await offlineQueue.processQueue(orgId, async () => {
      throw new Error('Network timeout');
    });

    expect(offlineQueue.getSummary(orgId).failed).toBe(1);

    // Retry resets status to pending
    const retried = offlineQueue.retry(orgId, action.id);
    expect(retried).toBe(true);
    expect(offlineQueue.getSummary(orgId).pending).toBe(1);
    expect(offlineQueue.getSummary(orgId).failed).toBe(0);

    // Process again with success
    await offlineQueue.processQueue(orgId, async () => {
      // Succeeded on retry
    });
    expect(offlineQueue.getSummary(orgId).synced).toBe(1);

    // Clear synced items
    const cleared = offlineQueue.clearSynced(orgId);
    expect(cleared).toBe(1);
    expect(offlineQueue.getAll(orgId).length).toBe(0);
  });

  describe('P1-03: Storage quota mitigation & automatic 24-hour pruning', () => {
    it('automatically prunes synced actions older than 24 hours on enqueue or save', () => {
      // 1. Action synced 25 hours ago (expired)
      offlineQueue.enqueue(orgId, 'RECORD_PAYMENT', { amount: 100 }, { idempotencyKey: 'old-1' });
      // Mutate queue directly in localStorage to simulate an action synced 25 hours ago
      const queue = JSON.parse(localStorage.getItem('atlas_offline_action_queue_v1') || '[]');
      queue[0].status = 'synced';
      queue[0].syncedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      localStorage.setItem('atlas_offline_action_queue_v1', JSON.stringify(queue));

      // 2. Action synced 1 hour ago (fresh)
      const freshSyncedAction = offlineQueue.enqueue(orgId, 'CREATE_ORDER', { orderId: 'fresh-1' }, { idempotencyKey: 'fresh-1' });
      const queue2 = JSON.parse(localStorage.getItem('atlas_offline_action_queue_v1') || '[]');
      const freshTarget = queue2.find((i: any) => i.id === freshSyncedAction.id);
      freshTarget.status = 'synced';
      freshTarget.syncedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      localStorage.setItem('atlas_offline_action_queue_v1', JSON.stringify(queue2));

      // 3. Enqueue a new pending action - should automatically trigger pruning of oldSyncedAction (>24h)
      offlineQueue.enqueue(orgId, 'ADJUST_STOCK', { qty: 5 }, { idempotencyKey: 'new-1' });

      const remaining = offlineQueue.getAll(orgId);
      expect(remaining.find((i) => i.idempotencyKey === 'old-1')).toBeUndefined();
      expect(remaining.find((i) => i.idempotencyKey === 'fresh-1')).toBeDefined();
      expect(remaining.find((i) => i.idempotencyKey === 'new-1')).toBeDefined();
    });

    it('emergency prunes all synced items when QuotaExceededError is encountered and retries', () => {
      // Setup a synced item and a pending item
      offlineQueue.enqueue(orgId, 'RECORD_PAYMENT', { amount: 100 }, { idempotencyKey: 'synced-to-purge' });
      const queue = JSON.parse(localStorage.getItem('atlas_offline_action_queue_v1') || '[]');
      queue[0].status = 'synced';
      queue[0].syncedAt = new Date().toISOString();
      localStorage.setItem('atlas_offline_action_queue_v1', JSON.stringify(queue));

      const originalSetItem = localStorage.setItem.bind(localStorage);
      let quotaThrown = false;

      // Mock setItem to throw QuotaExceededError when payload includes synced-to-purge
      localStorage.setItem = (key: string, value: string) => {
        if (!quotaThrown && value.includes('synced-to-purge')) {
          quotaThrown = true;
          const quotaErr = new Error('Quota exceeded') as any;
          quotaErr.name = 'QuotaExceededError';
          quotaErr.code = 22;
          throw quotaErr;
        }
        return originalSetItem(key, value);
      };

      try {
        // Enqueue new pending item: should trigger QuotaExceededError, catch it, emergency prune synced-to-purge, and retry
        const newAction = offlineQueue.enqueue(orgId, 'CREATE_INVOICE', { items: [] }, { idempotencyKey: 'must-survive' });

        expect(quotaThrown).toBe(true);
        expect(newAction.idempotencyKey).toBe('must-survive');

        // Verify synced action was purged while pending survived
        const items = offlineQueue.getAll(orgId);
        expect(items.find((i) => i.idempotencyKey === 'synced-to-purge')).toBeUndefined();
        expect(items.find((i) => i.idempotencyKey === 'must-survive')).toBeDefined();
      } finally {
        localStorage.setItem = originalSetItem;
      }
    });
  });
});

it('replays an interrupted sync using the original idempotency key', async () => {
  const orgId = 'org-interrupted';
  const action = offlineQueue.enqueue(orgId, 'CREATE_INVOICE', {}, { idempotencyKey: 'original-key' });
  localStorage.setItem('atlas_offline_action_queue_v1', JSON.stringify([{ ...action, status: 'syncing' }]));
  const synced: string[] = [];
  const result = await offlineQueue.processQueue(orgId, async (item) => {
    synced.push(item.idempotencyKey);
  });
  expect(synced).toEqual(['original-key']);
  expect(result).toMatchObject({ succeeded: 1, pendingRemaining: 0 });
});
