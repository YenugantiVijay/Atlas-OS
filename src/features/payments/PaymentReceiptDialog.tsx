import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { paymentsService } from '@/services/payments.service';
import { ReceiptSheet } from './ReceiptSheet';

export function PaymentReceiptDialog({ organizationId, paymentId, scope, onClose }: {
  organizationId: string; paymentId: string; scope: string; onClose: () => void;
}) {
  const [includeCounter, setIncludeCounter] = useState(true);
  const [printing, setPrinting] = useState(false);
  const printRootRef = useRef<HTMLDivElement>(null);
  const receipt = useQuery({
    queryKey: ['payment-receipt', scope, paymentId],
    queryFn: ({ signal }) => paymentsService.getReceiptPrintData(organizationId, paymentId, signal),
    staleTime: 0,
  });
  const document = receipt.data;
  const canPrint = document && receipt.isSuccess && !receipt.isFetching;
  const counterCopy = Boolean(document?.counterCopyAllowed && includeCounter);

  const print = async () => {
    const printRoot = printRootRef.current;
    if (!canPrint || !printRoot || printing) return;
    setPrinting(true);
    try {
      await Promise.all(Array.from(printRoot.querySelectorAll('img')).map((logo) =>
        Promise.race([logo.decode().catch(() => {}), new Promise<void>((resolve) => window.setTimeout(resolve, 800))]),
      ));
      if (printRoot.isConnected) window.print();
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Payment receipt" maxWidth="2xl">
      {receipt.isPending && <p role="status" className="text-sm text-content-secondary">Loading receipt…</p>}
      {receipt.isError && <div className="space-y-3">
        <p role="alert" className="text-sm text-rose-700">{receipt.error.message}</p>
        <Button size="sm" onClick={() => void receipt.refetch()}>Retry</Button>
      </div>}
      {document && receipt.isSuccess && <div className="space-y-4">
        <ReceiptSheet receipt={document} counterCopy={counterCopy} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          {document.counterCopyAllowed ? <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeCounter} disabled={printing} onChange={(event) => setIncludeCounter(event.target.checked)} />
            Include counter copy on the same sheet
          </label> : <span className="text-xs text-content-secondary">Customer copy · A4</span>}
          <Button type="button" disabled={!canPrint} isLoading={printing} leftIcon={<Printer size={16} />} onClick={() => void print()}>
            Print receipt
          </Button>
        </div>
        {canPrint && createPortal(
          <div ref={printRootRef} className="atlas-receipt-print-root" aria-hidden="true"><ReceiptSheet receipt={document} counterCopy={counterCopy} /></div>,
          window.document.body,
        )}
      </div>}
    </Modal>
  );
}
