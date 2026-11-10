/**
 * Client-side transport only. No localStorage fallback and no secrets in client.
 * Public endpoint and Cloudflare site key are build-time public settings.
 */
export type WebsiteLeadKind = 'contact' | 'demo' | 'release';

export const leadEndpoint = (import.meta.env.PUBLIC_LEAD_ENDPOINT || '').trim();
export const turnstileSiteKey = (import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || '').trim();
export const leadDeliveryConfigured = Boolean(leadEndpoint && turnstileSiteKey);

export function getOrCreateRequestId(
  current: { fingerprint: string; requestId: string } | null,
  data: unknown,
): { fingerprint: string; requestId: string } {
  const fingerprint = JSON.stringify(data);
  if (current?.fingerprint === fingerprint) return current;
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Secure submission is not supported by this browser.');
  }
  return { fingerprint, requestId: globalThis.crypto.randomUUID() };
}

export async function submitWebsiteLead(
  kind: WebsiteLeadKind,
  data: object,
  token: string,
  requestId: string,
): Promise<string> {
  if (!leadDeliveryConfigured) {
    throw new Error('Online enquiries are not configured yet. Please contact the team using a verified contact channel.');
  }
  if (!token) throw new Error('Please complete the human verification to continue.');

  let url: URL;
  try {
    url = new URL(leadEndpoint);
  } catch {
    throw new Error('The enquiry service address is invalid. Please contact support.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('The enquiry service must use a secure HTTPS connection.');
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, data, token, requestId }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Could not reach the enquiry service. Please check your connection and retry.');
  }

  let result: { ok?: boolean; reference?: string; error?: string } = {};
  try { result = await response.json(); } catch { /* Unexpected server reply */ }

  if (!response.ok || result.ok !== true || !result.reference) {
    if (response.status === 429) throw new Error('Too many enquiries were sent recently. Please try again later.');
    throw new Error(result.error || 'The enquiry was not delivered. Please try again later.');
  }
  return result.reference;
}
