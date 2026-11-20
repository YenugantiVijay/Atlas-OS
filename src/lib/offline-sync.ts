import { offlineQueue, QueuedOfflineAction, SyncProcessResult } from '@/lib/offline-queue';
import { invoicesService } from '@/services/invoices.service';
import { paymentsService } from '@/services/payments.service';
import { inventoryService } from '@/services/inventory.service';
import { ordersService } from '@/services/orders.service';

/**
 * Authoritative dispatcher for offline queued actions.
 * Executes mutations in FIFO order against Supabase cloud APIs when network is restored.
 */
export async function executeOfflineAction(action: QueuedOfflineAction): Promise<void> {
  switch (action.actionType) {
    case 'CREATE_INVOICE': {
      const invoice = await invoicesService.createInvoice(action.organizationId, {
        ...action.payload,
        idempotencyKey: action.idempotencyKey,
      }, false);
      if (invoice.id.startsWith('inv-offline-')) {
        throw new Error('Invoice remains pending: server confirmation was not received.');
      }
      break;
    }
    case 'RECORD_PAYMENT': {
      const payment = await paymentsService.recordPayment(action.organizationId, {
        ...action.payload,
        idempotencyKey: action.idempotencyKey,
      }, false);
      if (payment.id.startsWith('pay-offline-')) {
        throw new Error('Payment remains pending: server confirmation was not received.');
      }
      break;
    }
    case 'ADJUST_STOCK': {
      const movement = await inventoryService.adjustStock(
        action.organizationId,
        action.payload.productId,
        action.payload.quantityChange,
        action.payload.notes,
        action.idempotencyKey,
        false
      );
      if (movement.id.startsWith('mov-offline-')) {
        throw new Error('Stock adjustment remains pending: server confirmation was not received.');
      }
      break;
    }
    case 'CREATE_ORDER': {
      await ordersService.createSalesOrder(action.organizationId, {
        ...action.payload,
        idempotencyKey: action.idempotencyKey,
      }, false);
      break;
    }
    default: {
      throw new Error(`Unsupported offline action type: ${action.actionType}`);
    }
  }
}

/**
 * Processes queued actions sequentially for the specified organization (or all organizations).
 */
export async function flushOfflineSync(organizationId?: string): Promise<SyncProcessResult> {
  if (organizationId) {
    return offlineQueue.processQueue(organizationId, executeOfflineAction);
  }

  // If no org specified, find all orgs with items in queue
  const allItems = offlineQueue.getAll();
  const orgIds = Array.from(new Set(allItems.map((i) => i.organizationId).filter(Boolean)));

  const combined: SyncProcessResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    pendingRemaining: 0,
  };

  for (const orgId of orgIds) {
    const res = await offlineQueue.processQueue(orgId, executeOfflineAction);
    combined.processed += res.processed;
    combined.succeeded += res.succeeded;
    combined.failed += res.failed;
    combined.pendingRemaining += res.pendingRemaining;
  }

  return combined;
}

/**
 * Registers a window 'online' event listener to automatically sync queued actions
 * whenever network connectivity is restored.
 */
export function initOfflineSyncListener(getOrgId?: () => string | undefined): () => void {
  if (typeof window === 'undefined') return () => {};

  const onOnline = () => {
    const orgId = getOrgId ? getOrgId() : undefined;
    void flushOfflineSync(orgId);
  };

  window.addEventListener('online', onOnline);
  return () => {
    window.removeEventListener('online', onOnline);
  };
}
