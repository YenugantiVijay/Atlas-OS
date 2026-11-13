import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Send } from 'lucide-react';
import TurnstileWidget from '../common/TurnstileWidget';
import { getOrCreateRequestId, leadDeliveryConfigured, submitWebsiteLead } from '../../lib/websiteLeads';
import { PRICING_TIERS } from '../../data/pricing';
import type { DemoRequestPayload } from '../../types';

const EMPTY_FORM: DemoRequestPayload = {
  fullName: '', businessName: '', email: '', phone: '', city: '',
  industry: 'general_retail', businessSize: '1_to_5', primaryRequirement: 'stock_billing_payments', additionalMessage: '',
};
const CONTACT_FIELDS = [
  { id: 'fullName', label: 'Full name', autoComplete: 'name', maxLength: 120 },
  { id: 'businessName', label: 'Business name', autoComplete: 'organization', maxLength: 160 },
  { id: 'email', label: 'Email', type: 'email', autoComplete: 'email', maxLength: 254 },
  { id: 'phone', label: 'Phone / WhatsApp', type: 'tel', autoComplete: 'tel', maxLength: 40 },
  { id: 'city', label: 'City / region', autoComplete: 'address-level2', maxLength: 120 },
] as const;
const INDUSTRIES = [
  ['general_retail', 'Small shop / general retail'], ['agricultural_inputs', 'Fertilizers & agri inputs'],
  ['general_wholesale', 'General wholesale & distribution'], ['electrical_wholesale', 'Electrical wholesale'],
  ['electronics', 'Electronics & components'], ['hardware', 'Hardware & tools'], ['other', 'Other business'],
];
const TEAM_SIZES = [['1_to_5', '1–5 people'], ['6_to_20', '6–20 people'], ['21_to_50', '21–50 people'], ['51_plus', '51+ people']];
const PRIORITIES = [
  ['stock_billing_payments', 'Stock, billing and payments'],
  ['purchasing', 'Purchasing and supplier rates'],
  ['receipts_and_collections', 'Receipts and collections'],
  ['migration', 'Moving from Excel or an ERP'],
  ['other', 'Something else'],
];
const CONTROL = 'block min-h-10 w-full min-w-0 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm font-normal text-content-primary focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/20';

export default function RequestDemoForm() {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [plan, setPlan] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [resetCounter, setResetCounter] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const requestRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const sending = useRef(false);

  useEffect(() => {
    const selected = new URLSearchParams(location.search).get('tier');
    const tier = PRICING_TIERS.find((item) => item.id === (selected === 'essentials' ? 'starter' : selected));
    setPlan(tier?.name ?? '');
  }, []);

  const update = (key: keyof DemoRequestPayload, value: string) => setFormData((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending.current) return;
    setError('');
    if (honeypot) { setError('Verification failed. Please try again.'); return; }
    if (CONTACT_FIELDS.some(({ id }) => !formData[id].trim())) {
      setError('Complete the contact details before sending your request.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    const digits = formData.phone.replace(/\D/g, '');
    if (!/^[+\d\s()-]+$/.test(formData.phone) || digits.length < 10 || digits.length > 15) {
      setError('Enter a phone number with 10 to 15 digits.');
      return;
    }
    const data = {
      ...formData,
      additionalMessage: [plan && 'Plan interest: ' + plan, formData.additionalMessage?.trim()].filter(Boolean).join('\n'),
    };
    sending.current = true;
    setIsSubmitting(true);
    try {
      const request = getOrCreateRequestId(requestRef.current, data);
      requestRef.current = request;
      setReference(await submitWebsiteLead('demo', data, turnstileToken, request.requestId));
      requestRef.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your request could not be delivered. Try again.');
      setTurnstileToken('');
      setResetCounter((value) => value + 1);
    } finally {
      setIsSubmitting(false);
      sending.current = false;
    }
  };

  if (reference) return (
    <div role="status" className="space-y-3 rounded-2xl border border-brand-200 bg-white p-6 shadow-sm">
      <CheckCircle2 className="text-brand-700" size={28} aria-hidden="true" />
      <h2 className="text-xl font-bold">Demonstration Request Received</h2>
      <p className="text-sm text-content-secondary">We’ll use your contact details to arrange the walkthrough.</p>
      <p className="break-all text-xs text-content-secondary">Reference <strong>{reference}</strong></p>
      <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => {
        setFormData(EMPTY_FORM); setReference(''); setTurnstileToken(''); setResetCounter((value) => value + 1);
      }}>Submit another enquiry</button>
    </div>
  );

  return (
    <form onSubmit={submit} aria-label="Request a demo" className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
      <div className="space-y-1 border-b border-border pb-3">
        <h2 className="text-xl font-bold">Request a demo</h2>
        <p className="text-sm text-content-secondary">{plan ? 'Discuss ' + plan + ' with our team.' : 'Leave your details and we’ll get in touch.'}</p>
      </div>
      {error && <p role="alert" className="flex gap-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-800"><AlertCircle size={17} className="shrink-0" />{error}</p>}
      {!leadDeliveryConfigured && <p role="status" className="rounded-lg bg-surface-secondary p-2.5 text-sm text-content-secondary">Online requests are currently unavailable. <a href="/contact" className="font-semibold text-brand-700 underline">Contact Atlas OS</a>.</p>}
      <div hidden aria-hidden="true">
        <label htmlFor="website-trap">Leave this blank</label>
        <input id="website-trap" type="text" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} tabIndex={-1} autoComplete="off" />
      </div>
      <fieldset disabled={isSubmitting} className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-2">
        {CONTACT_FIELDS.map((item) => <label key={item.id} htmlFor={item.id} className="min-w-0 space-y-1 text-xs font-semibold">
          <span>{item.label}</span>
          <input id={item.id} className={CONTROL} type={'type' in item ? item.type : 'text'} required autoComplete={item.autoComplete}
            maxLength={item.maxLength} value={formData[item.id]} onChange={(event) => update(item.id, event.target.value)} />
        </label>)}
        {([
          ['industry', 'Business type', INDUSTRIES], ['businessSize', 'Team size', TEAM_SIZES],
          ['primaryRequirement', 'What would you like to see?', PRIORITIES],
        ] as const).map(([key, label, options]) => <label key={key} htmlFor={key} className="min-w-0 space-y-1 text-xs font-semibold">
          <span>{label}</span>
          <select id={key} className={CONTROL} value={formData[key]} onChange={(event) => update(key, event.target.value)}>
            {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
        </label>)}
        <label htmlFor="additionalMessage" className="space-y-1 text-xs font-semibold sm:col-span-2">
          <span>Notes <span className="font-normal text-content-secondary">(optional)</span></span>
          <textarea id="additionalMessage" rows={2} maxLength={1800} className={CONTROL + ' resize-y'} value={formData.additionalMessage}
            placeholder="Tell us about a workflow you want to see." onChange={(event) => update('additionalMessage', event.target.value)} />
        </label>
      </fieldset>
      <TurnstileWidget action="lead_demo" onToken={setTurnstileToken} resetCounter={resetCounter} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="max-w-[25ch] text-xs leading-relaxed text-content-secondary">We use your details to arrange the demo.</p>
        <button type="submit" disabled={isSubmitting || !leadDeliveryConfigured || !turnstileToken} className="btn-shimmer inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto">
          <Send size={15} aria-hidden="true" />{isSubmitting ? 'Sending…' : 'Confirm Demonstration Request'}
        </button>
      </div>
    </form>
  );
}
