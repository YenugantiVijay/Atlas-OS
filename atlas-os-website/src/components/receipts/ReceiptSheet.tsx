import './receipt-sheet.css';

export interface ReceiptData {
  businessName: string;
  legalName?: string | null;
  logoUrl?: string | null;
  businessAddress?: string | null;
  contact?: string | null;
  gstin?: string | null;
  template: 'classic' | 'compact';
  message?: string | null;
  number: string;
  date: string;
  customer: string;
  method: string;
  reference?: string | null;
  amount: number;
  currency: string;
}

export const DEFAULT_RECEIPT_LOGO = '/favicon.svg';

export function receiptLogoSource(url?: string | null) {
  if (url && (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(url) || /^https:\/\/[^\s]+$/i.test(url))) return url;
  return DEFAULT_RECEIPT_LOGO;
}

function ReceiptCopy({ receipt, copy }: { receipt: ReceiptData; copy: string }) {
  const currency = /^[a-z]{3}$/i.test(receipt.currency) ? receipt.currency : 'INR';
  const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(receipt.amount);
  const paymentDate = new Date(receipt.date + 'T00:00:00Z');
  const date = Number.isNaN(paymentDate.getTime()) ? receipt.date
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(paymentDate);
  return (
    <article className={'atlas-receipt atlas-receipt--' + receipt.template} aria-label={copy}>
      <div className="atlas-receipt__heading">
        <img src={receiptLogoSource(receipt.logoUrl)} alt="" width="44" height="44" referrerPolicy="no-referrer" onError={(event) => {
          if (event.currentTarget.getAttribute('src') !== DEFAULT_RECEIPT_LOGO) event.currentTarget.src = DEFAULT_RECEIPT_LOGO;
        }} />
        <div>
          <h3>{receipt.businessName}</h3>
          {receipt.legalName && receipt.legalName !== receipt.businessName && <p>{receipt.legalName}</p>}
          {receipt.businessAddress && <p>{receipt.businessAddress}</p>}
          {receipt.contact && <p>{receipt.contact}</p>}
          {receipt.gstin && <p>GSTIN {receipt.gstin}</p>}
        </div>
        <span className="atlas-receipt__copy">{copy}</span>
      </div>
      <div className="atlas-receipt__identity"><strong>Payment receipt</strong><span>{receipt.number}</span></div>
      <dl className="atlas-receipt__details">
        <div><dt>Received from</dt><dd>{receipt.customer}</dd></div>
        <div><dt>Payment date</dt><dd>{date}</dd></div>
        <div><dt>Payment method</dt><dd>{receipt.method.replace(/_/g, ' ')}</dd></div>
        {receipt.reference && <div><dt>Reference</dt><dd>{receipt.reference}</dd></div>}
      </dl>
      <div className="atlas-receipt__amount"><span>Amount received</span><strong>{amount}</strong></div>
      {receipt.message && <p className="atlas-receipt__message">{receipt.message}</p>}
    </article>
  );
}

export function ReceiptSheet({ receipt, counterCopy = false }: { receipt: ReceiptData; counterCopy?: boolean }) {
  return (
    <div className="atlas-receipt-sheet">
      <ReceiptCopy receipt={receipt} copy="Customer copy" />
      {counterCopy && <><div className="atlas-receipt-cut" aria-hidden="true" /><ReceiptCopy receipt={receipt} copy="Counter copy" /></>}
    </div>
  );
}
