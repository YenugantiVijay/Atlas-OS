import React, { useEffect, useRef } from 'react';
import { turnstileSiteKey } from '../../lib/websiteLeads';

type TurnstileOptions = {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
};
type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileOptions) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi }
}

interface Props {
  action: 'lead_contact' | 'lead_demo' | 'lead_release';
  onToken: (token: string) => void;
  resetCounter: number;
}

/**
 * Explicit Cloudflare Turnstile widget. No secret is put into the website.
 * The server independently validates the token, action and calling hostname.
 */
export default function TurnstileWidget({ action, onToken, resetCounter }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!turnstileSiteKey) return;
    let mounted = true;
    let widgetId: string | undefined;
    const renderWidget = () => {
      if (!mounted || widgetId || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: turnstileSiteKey,
        action,
        callback: (token) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(''),
        'error-callback': () => onTokenRef.current(''),
      });
    };

    const src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    let script = document.querySelector<HTMLScriptElement>('script[data-atlas-turnstile]');
    if (!script) {
      script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.atlasTurnstile = 'true';
      document.head.appendChild(script);
    }
    script.addEventListener('load', renderWidget);
    renderWidget();

    return () => {
      mounted = false;
      script?.removeEventListener('load', renderWidget);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      onTokenRef.current('');
    };
  }, [action, resetCounter]);

  if (!turnstileSiteKey) {
    return <p role="status" className="text-sm text-amber-800">Enquiries are unavailable until secure verification is configured.</p>;
  }
  return (
    <div>
      <div ref={container} aria-label="Human verification" />
      <p className="mt-2 text-xs text-content-muted">
        Protected by Cloudflare Turnstile. Please complete verification before sending.
      </p>
    </div>
  );
}
