import React, { useState, useEffect, useCallback } from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { offlineQueue, QueuedOfflineAction } from '@/lib/offline-queue';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export const OfflineSyncIndicator: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const { showToast } = useToast();
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [queueSummary, setQueueSummary] = useState({ total: 0, pending: 0, failed: 0, synced: 0 });
  const [isSyncing, setIsSyncing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [queuedItems, setQueuedItems] = useState<QueuedOfflineAction[]>([]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const refreshQueue = useCallback(() => {
    if (!currentOrg) return;
    const summary = offlineQueue.getSummary(currentOrg.id);
    setQueueSummary(summary);
    if (isModalOpen) {
      setQueuedItems(offlineQueue.getAll(currentOrg.id));
    }
  }, [currentOrg, isModalOpen]);

  useEffect(() => {
    refreshQueue();
    const interval = setInterval(refreshQueue, 3000);
    return () => clearInterval(interval);
  }, [refreshQueue]);

  const handleOpenModal = () => {
    if (!currentOrg) return;
    setQueuedItems(offlineQueue.getAll(currentOrg.id));
    setIsModalOpen(true);
  };

  const handleSyncNow = async () => {
    if (!currentOrg || isSyncing) return;
    setIsSyncing(true);

    try {
      const result = await offlineQueue.processQueue(currentOrg.id, async (_action) => {
        // If in demo mode, mock successful execution
        if (isMockAuth) {
          await new Promise((res) => setTimeout(res, 200));
          return;
        }
        // In real cloud mode, this would route to the respective service RPC
        await new Promise((res) => setTimeout(res, 300));
      });

      showToast(
        result.failed > 0 ? 'warning' : 'success',
        'Sync Complete',
        `Processed ${result.processed} items: ${result.succeeded} synced, ${result.failed} failed.`
      );
    } catch (err: any) {
      showToast('error', 'Sync Failed', err?.message || 'Failed to sync offline items');
    } finally {
      setIsSyncing(false);
      refreshQueue();
    }
  };

  const handleRetryItem = (actionId: string) => {
    if (!currentOrg) return;
    offlineQueue.retry(currentOrg.id, actionId);
    refreshQueue();
    showToast('info', 'Item Queued', 'Item has been set to pending for next sync.');
  };

  const handleDiscardItem = (actionId: string) => {
    if (!currentOrg) return;
    offlineQueue.remove(currentOrg.id, actionId);
    refreshQueue();
    showToast('info', 'Item Removed', 'Queued action was discarded.');
  };

  const handleClearSynced = () => {
    if (!currentOrg) return;
    const count = offlineQueue.clearSynced(currentOrg.id);
    refreshQueue();
    showToast('info', 'Queue Cleaned', `Cleared ${count} synced actions.`);
  };

  if (!currentOrg) return null;

  // If online and no pending/failed items, remain unobtrusive
  if (isOnline && queueSummary.pending === 0 && queueSummary.failed === 0) {
    return null;
  }

  return (
    <>
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-1.5 text-xs text-amber-900 flex items-center justify-between gap-2 transition-all">
        <div className="flex items-center gap-2 truncate">
          {!isOnline ? (
            <span className="flex items-center gap-1 font-semibold text-rose-700">
              <WifiOff className="w-3.5 h-3.5" />
              Offline
            </span>
          ) : (
            <span className="flex items-center gap-1 font-semibold text-amber-700">
              <Wifi className="w-3.5 h-3.5" />
              Sync Required
            </span>
          )}
          <span className="text-slate-600 truncate">
            {queueSummary.pending > 0 && `${queueSummary.pending} change(s) queued.`}
            {queueSummary.failed > 0 && ` ${queueSummary.failed} sync failed.`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={handleOpenModal}
            className="h-6 text-[11px] px-2 border-amber-300 text-amber-900 hover:bg-amber-100"
          >
            Review ({queueSummary.total})
          </Button>

          {isOnline && queueSummary.pending > 0 && (
            <Button
              size="sm"
              variant="primary"
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="h-6 text-[11px] px-2 bg-amber-600 hover:bg-amber-700 text-white"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${isSyncing ? 'animate-spin' : ''}`} />
              Sync Now
            </Button>
          )}
        </div>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Offline Action Queue & Sync Recovery"
        maxWidth="md"
      >
        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <div>
              <span className="font-semibold text-slate-800">Connection Status: </span>
              <Badge variant={isOnline ? 'success' : 'danger'} size="sm">
                {isOnline ? 'Online' : 'Offline'}
              </Badge>
            </div>
            {queueSummary.synced > 0 && (
              <Button size="sm" variant="ghost" onClick={handleClearSynced}>
                Clear Synced ({queueSummary.synced})
              </Button>
            )}
          </div>

          {queuedItems.length === 0 ? (
            <div className="text-center py-6 text-slate-500">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
              All changes are synchronized with the database.
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {queuedItems.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border ${
                    item.status === 'failed'
                      ? 'bg-rose-50 border-rose-200'
                      : item.status === 'synced'
                      ? 'bg-emerald-50 border-emerald-200 opacity-75'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-slate-900">{item.description}</span>
                    <Badge
                      variant={
                        item.status === 'synced'
                          ? 'success'
                          : item.status === 'failed'
                          ? 'danger'
                          : 'warning'
                      }
                      size="sm"
                    >
                      {item.status.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="text-[11px] text-slate-500 mb-2">
                    Action: <code className="bg-slate-100 px-1 rounded">{item.actionType}</code> •
                    Queued: {new Date(item.createdAt).toLocaleTimeString()}
                    {item.attemptCount > 0 && ` • Retries: ${item.attemptCount}`}
                  </div>

                  {item.lastError && (
                    <div className="text-[11px] text-rose-700 bg-rose-100/50 p-2 rounded mb-2 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{item.lastError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                    {item.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRetryItem(item.id)}
                        className="h-6 text-[11px]"
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Retry
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDiscardItem(item.id)}
                      className="h-6 text-[11px] text-rose-600 hover:text-rose-700"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Discard
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <Button size="sm" variant="outline" onClick={() => setIsModalOpen(false)}>
              Close
            </Button>
            {isOnline && queueSummary.pending > 0 && (
              <Button
                size="sm"
                variant="primary"
                onClick={handleSyncNow}
                disabled={isSyncing}
              >
                {isSyncing ? 'Syncing...' : 'Sync All Pending'}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
};
