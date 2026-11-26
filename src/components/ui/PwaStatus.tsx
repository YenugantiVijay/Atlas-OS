import { useEffect, useState } from 'react';

/** Registration is production-only; updates never reload unsaved business forms. */
export function PwaStatus() {
  const [update, setUpdate] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const check = () => { if (navigator.onLine) void registration?.update().catch(() => undefined); };
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
      if (disposed) return;
      registration = reg;
      const inspect = () => {
        if (reg.waiting && navigator.serviceWorker.controller && !disposed) setUpdate(true);
        reg.installing?.addEventListener('statechange', () => {
          if (reg.waiting && navigator.serviceWorker.controller && !disposed) setUpdate(true);
        });
      };
      inspect(); reg.addEventListener('updatefound', inspect);
    }).catch(() => { if (!disposed) setFailed(true); });
    window.addEventListener('online', check);
    window.addEventListener('focus', check);
    return () => { disposed = true; window.removeEventListener('online', check); window.removeEventListener('focus', check); };
  }, []);
  return <aside aria-label="Atlas OS installation" className="border-b border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
    <a className="underline" href="/install.html">Install Atlas OS</a>
    {update && <span role="status" className="ml-4">Update ready. Save your work, close all Atlas OS windows, and reopen to update.</span>}
    {failed && <span role="status" className="ml-4">Offline support unavailable. You can continue online.</span>}
  </aside>;
}
