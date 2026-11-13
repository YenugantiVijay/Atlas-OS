import { useEffect, useRef, useState } from 'react';
import { ReceiptSheet, type ReceiptData } from './ReceiptSheet';

const SAMPLE: ReceiptData = {
  businessName: 'Your Business', businessAddress: 'Guntur, Andhra Pradesh', template: 'classic',
  message: 'Thank you for your business.', number: 'RCPT-SAMPLE-001', date: '2026-11-13',
  customer: 'Sample Customer', method: 'UPI', reference: 'UPI-SAMPLE', amount: 1325, currency: 'INR',
};

export default function ReceiptTemplates() {
  const [receipt, setReceipt] = useState(SAMPLE);
  const [counterCopy, setCounterCopy] = useState(false);
  const [error, setError] = useState('');
  const upload = useRef(0);
  const field = 'mt-1 w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-normal focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/20';
  useEffect(() => () => { upload.current += 1; }, []);

  const changeLogo = async (file?: File) => {
    const attempt = ++upload.current;
    setError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Choose a PNG, JPG, or WebP image up to 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => { if (upload.current === attempt) setError('The logo could not be read.'); };
    reader.onload = () => {
      if (upload.current === attempt && typeof reader.result === 'string') setReceipt((current) => ({ ...current, logoUrl: String(reader.result) }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3 rounded-2xl border border-border bg-white p-5 shadow-sm">
        <label className="block text-sm font-semibold">Layout
          <select value={receipt.template} className={field} onChange={(event) => setReceipt({ ...receipt, template: event.target.value === 'compact' ? 'compact' : 'classic' })}>
            <option value="classic">Classic</option><option value="compact">Compact</option>
          </select>
        </label>
        <label className="block text-sm font-semibold">Business name
          <input value={receipt.businessName} maxLength={100} className={field} onChange={(event) => setReceipt({ ...receipt, businessName: event.target.value })} />
        </label>
        <label className="block text-sm font-semibold">Business address
          <input value={receipt.businessAddress ?? ''} maxLength={140} className={field} onChange={(event) => setReceipt({ ...receipt, businessAddress: event.target.value })} />
        </label>
        <label className="block text-sm font-semibold">Receipt message
          <input value={receipt.message ?? ''} maxLength={160} className={field} onChange={(event) => setReceipt({ ...receipt, message: event.target.value })} />
        </label>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-brand-700">Contact and tax details</summary>
          <div className="mt-2 space-y-2">
            <label className="block font-semibold">Business contact
              <input value={receipt.contact ?? ''} maxLength={120} className={field} onChange={(event) => setReceipt({ ...receipt, contact: event.target.value })} />
            </label>
            <label className="block font-semibold">GSTIN
              <input value={receipt.gstin ?? ''} maxLength={15} className={field} onChange={(event) => setReceipt({ ...receipt, gstin: event.target.value.toUpperCase() })} />
            </label>
          </div>
        </details>
        <label className="block text-sm font-semibold">Upload your logo
          <input type="file" accept="image/png,image/jpeg,image/webp" className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-brand-50 file:px-2 file:py-2 file:font-semibold file:text-brand-800"
            onChange={(event) => { void changeLogo(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        {receipt.logoUrl && <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => {
          upload.current += 1;
          setError('');
          setReceipt({ ...receipt, logoUrl: undefined });
        }}>Use default logo</button>}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <label className="flex items-start gap-2 border-t border-border pt-3 text-sm">
          <input type="checkbox" checked={counterCopy} onChange={(event) => setCounterCopy(event.target.checked)} className="mt-1" />
          <span>Preview customer and counter copies<span className="block text-xs text-content-secondary">Professional and Enterprise Network</span></span>
        </label>
        <p className="text-xs text-content-secondary">Preview changes stay in your browser.</p>
      </div>
      <div className="min-w-0 rounded-2xl border border-border bg-surface-secondary p-3 sm:p-5" aria-label="Sample payment receipt">
        <ReceiptSheet receipt={{ ...receipt, businessName: receipt.businessName.trim() || SAMPLE.businessName }} counterCopy={counterCopy} />
      </div>
    </div>
  );
}
