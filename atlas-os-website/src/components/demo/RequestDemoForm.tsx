import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, Send } from 'lucide-react';
import TurnstileWidget from '../common/TurnstileWidget';
import { getOrCreateRequestId, leadDeliveryConfigured, submitWebsiteLead } from '../../lib/websiteLeads';
import { PRICING_TIERS } from '../../data/pricing';
import type { DemoRequestPayload } from '../../types';
import './request-demo-form.css';

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
  ["banner_print_studio", "Banner & Print Studio"],
  ["ice_cream_stalls", "Ice Cream Stalls"],
  ["ice_cream_distribution", "Ice Cream Distribution"],
  ['ecommerce', 'E-commerce / online sales'], ['general_retail', 'Small shop / retail'], ['agricultural_inputs', 'Fertilizers & agri inputs'],
  ['general_wholesale', 'Wholesale & distribution'], ['electrical_wholesale', 'Electrical wholesale'],
  ['electronics', 'Electronics & components'], ['hardware', 'Hardware & tools'], ['other', 'Other business'],
];
const TEAM_SIZES = [['1_to_5', '1–5 people'], ['6_to_20', '6–20 people'], ['21_to_50', '21–50 people'], ['51_plus', '51+ people']];
const PRIORITIES = [
  ['stock_billing_payments', 'Stock, billing & payments'],
  ['purchasing', 'Purchasing & supplier rates'],
  ['receipts_and_collections', 'Receipts and collections'],
  ['migration', 'Moving from Excel or an ERP'],
  ['other', 'Something else'],
];
const CONTROL = 'demo-request__control';

export default function RequestDemoForm({ initialIndustry = EMPTY_FORM.industry }: { initialIndustry?: string }) {
  const [formData, setFormData] = useState(() => ({ ...EMPTY_FORM, industry: initialIndustry }));
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

  const heading = (
    <div className="demo-request__heading">
      <span className="demo-request__icon"><CalendarDays size={19} aria-hidden="true" /></span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold leading-snug text-content-primary sm:text-xl">Request a demo</h2>
        {leadDeliveryConfigured && (
          <p className="mt-0.5 text-sm text-content-secondary">
            {plan ? 'Discuss ' + plan + ' with our team.' : 'Tell us what you’d like to see.'}
          </p>
        )}
      </div>
    </div>
  );

  if (reference) return (
    <div role="status" className="demo-request space-y-2">
      <CheckCircle2 className="text-brand-700" size={24} aria-hidden="true" />
      <h2 className="text-lg font-bold">Demonstration Request Received</h2>
      <p className="text-sm text-content-secondary">We’ll be in touch to arrange your walkthrough.</p>
      <p className="break-all text-xs text-content-secondary">Reference <strong>{reference}</strong></p>
      <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => {
        setFormData({ ...EMPTY_FORM, industry: initialIndustry }); setReference(''); setTurnstileToken(''); setResetCounter((value) => value + 1);
      }}>Submit another enquiry</button>
    </div>
  );

  if (!leadDeliveryConfigured) return (
    <section aria-label="Request a demo" className="demo-request space-y-3">
      {heading}
      <p role="status" className="text-sm text-content-secondary">Online demo requests are temporarily unavailable.</p>
      <a href="/product" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-brand-700 underline-offset-4 hover:underline">
        Explore Atlas OS <ArrowRight size={15} aria-hidden="true" />
      </a>
    </section>
  );

  return (
    <form onSubmit={submit} aria-label="Request a demo" className="demo-request space-y-3">
      {heading}
      {error && <p role="alert" className="flex gap-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-800"><AlertCircle size={17} className="shrink-0" />{error}</p>}
      <div hidden aria-hidden="true">
        <label htmlFor="website-trap">Leave this blank</label>
        <input id="website-trap" type="text" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} tabIndex={-1} autoComplete="off" />
      </div>
      <fieldset disabled={isSubmitting} className="demo-request__fields">
        {CONTACT_FIELDS.map((item) => <label key={item.id} htmlFor={item.id} className="min-w-0 space-y-1 text-xs font-semibold">
          <span>{item.label}</span>
          <input id={item.id} className={CONTROL} type={'type' in item ? item.type : 'text'} required autoComplete={item.autoComplete}
            maxLength={item.maxLength} value={formData[item.id]} onChange={(event) => update(item.id, event.target.value)} />
        </label>)}
        {([
          ['industry', 'Business type', INDUSTRIES], ['businessSize', 'Team size', TEAM_SIZES],
          ['primaryRequirement', 'Demo focus', PRIORITIES],
        ] as const).map(([key, label, options]) => <label key={key} htmlFor={key} className="demo-request__selection min-w-0 space-y-1 text-xs font-semibold">
          <span>{label}</span>
          <select id={key} className={CONTROL + ' appearance-auto'} value={formData[key]} onChange={(event) => update(key, event.target.value)}>
            {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>
        </label>)}
        <details className="demo-request__notes">
          <summary className="w-fit cursor-pointer text-sm font-semibold text-brand-700">Add a note <span className="font-normal text-content-secondary">(optional)</span></summary>
          <label htmlFor="additionalMessage" className="sr-only">Notes</label>
          <textarea id="additionalMessage" rows={2} maxLength={1800} className={CONTROL + ' mt-2 resize-y'} value={formData.additionalMessage}
            placeholder="Tell us about a workflow you want to see." onChange={(event) => update('additionalMessage', event.target.value)} />
        </details>
      </fieldset>
      <TurnstileWidget action="lead_demo" onToken={setTurnstileToken} resetCounter={resetCounter} />
      <div className="demo-request__actions">
        <button type="submit" disabled={isSubmitting || !leadDeliveryConfigured || !turnstileToken} className="demo-request__submit">
          <Send size={15} aria-hidden="true" />{isSubmitting ? 'Sending…' : 'Send demo request'}
        </button>
      </div>
    </form>
  );
}
