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
});
