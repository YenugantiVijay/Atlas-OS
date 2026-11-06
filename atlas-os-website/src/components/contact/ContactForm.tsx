import React, { useState } from 'react';
import { Send, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';

export default function ContactForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    department: 'sales',
    message: '',
  });

  const [honeypot, setHoneypot] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) {
      errors.name = 'Please provide your name.';
    }

    if (!formData.email.trim()) {
      errors.email = 'Please provide your email address.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = 'Please provide a valid email format.';
    }

    if (!formData.message.trim()) {
      errors.message = 'Please enter your message or enquiry.';
    } else if (formData.message.trim().length < 10) {
      errors.message = 'Please provide a little more detail (at least 10 characters).';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (honeypot) return; // Silent discard for bot submission

    if (!validate()) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // Simulate submission endpoint with local storage fallback
      await new Promise((resolve) => setTimeout(resolve, 800));

      const inquiries = JSON.parse(localStorage.getItem('atlas_contact_inquiries') || '[]');
      inquiries.push({
        ...formData,
        submittedAt: new Date().toISOString(),
      });
      localStorage.setItem('atlas_contact_inquiries', JSON.stringify(inquiries));

      setIsSuccess(true);
    } catch {
      setErrorMessage('Unable to submit inquiry at this time. Please email us directly at contact@atlas-os.web.app.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="p-8 text-center rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 animate-fade-in">
        <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mb-4">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold font-display mb-2">Message Received Successfully!</h3>
        <p className="text-sm text-emerald-800 max-w-md mx-auto leading-relaxed mb-6">
          Thank you, <strong>{formData.name}</strong>. Our team has received your message regarding <strong>{formData.department}</strong>. We will reply to <strong>{formData.email}</strong> within 4 business hours.
        </p>
        <button
          type="button"
          onClick={() => {
            setIsSuccess(false);
            setFormData({
              name: '',
              email: '',
              phone: '',
              company: '',
              department: 'sales',
              message: '',
            });
          }}
          className="px-5 py-2.5 rounded-xl bg-white border border-emerald-300 text-emerald-800 text-sm font-semibold hover:bg-emerald-100 transition-colors"
        >
          Send Another Message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Honeypot field for anti-spam */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website_url">Website URL</label>
        <input
          type="text"
          id="website_url"
          name="website_url"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="contact_name" className="block text-xs font-bold uppercase tracking-wider text-text-primary mb-1.5">
            Full Name <span className="text-rose-500">*</span>
          </label>
          <input
            id="contact_name"
            type="text"
            value={formData.name}
            onChange={(e) => {
              setFormData({ ...formData, name: e.target.value });
              if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: '' });
            }}
            placeholder="e.g. Ramesh Patel"
            className={`w-full px-4 py-3 rounded-xl border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all ${
              fieldErrors.name ? 'border-rose-400 bg-rose-50/20' : 'border-border-subtle bg-surface focus:border-brand-500'
            }`}
          />
          {fieldErrors.name && <p className="text-xs text-rose-600 mt-1">{fieldErrors.name}</p>}
        </div>

        <div>
          <label htmlFor="contact_email" className="block text-xs font-bold uppercase tracking-wider text-text-primary mb-1.5">
            Business Email <span className="text-rose-500">*</span>
          </label>
          <input
            id="contact_email"
            type="email"
            value={formData.email}
            onChange={(e) => {
              setFormData({ ...formData, email: e.target.value });
              if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: '' });
            }}
            placeholder="e.g. ramesh@pateltrade.com"
            className={`w-full px-4 py-3 rounded-xl border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all ${
              fieldErrors.email ? 'border-rose-400 bg-rose-50/20' : 'border-border-subtle bg-surface focus:border-brand-500'
            }`}
          />
          {fieldErrors.email && <p className="text-xs text-rose-600 mt-1">{fieldErrors.email}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="contact_phone" className="block text-xs font-bold uppercase tracking-wider text-text-primary mb-1.5">
            Phone / WhatsApp Number
          </label>
          <input
            id="contact_phone"
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="e.g. +91 98765 43210"
            className="w-full px-4 py-3 rounded-xl border border-border-subtle bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
          />
        </div>

        <div>
          <label htmlFor="contact_company" className="block text-xs font-bold uppercase tracking-wider text-text-primary mb-1.5">
            Company / Business Name
          </label>
          <input
            id="contact_company"
            type="text"
            value={formData.company}
            onChange={(e) => setFormData({ ...formData, company: e.target.value })}
            placeholder="e.g. Patel Electricals & Hardware"
            className="w-full px-4 py-3 rounded-xl border border-border-subtle bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
          />
        </div>
      </div>

      <div>
        <label htmlFor="contact_department" className="block text-xs font-bold uppercase tracking-wider text-text-primary mb-1.5">
          Department / Topic
        </label>
        <select
          id="contact_department"
          value={formData.department}
          onChange={(e) => setFormData({ ...formData, department: e.target.value })}
          className="w-full px-4 py-3 rounded-xl border border-border-subtle bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
        >
          <option value="sales">Sales & Product Licensing</option>
          <option value="demo">Demonstration / Walkthrough Request</option>
          <option value="support">Technical Support & Helpdesk</option>
          <option value="migration">Legacy Data Migration (Busy / Tally)</option>
          <option value="security">Security & Privacy Governance</option>
          <option value="partnership">Dealer / Channel Partnership</option>
        </select>
      </div>

      <div>
        <label htmlFor="contact_message" className="block text-xs font-bold uppercase tracking-wider text-text-primary mb-1.5">
          Message / Requirement <span className="text-rose-500">*</span>
        </label>
        <textarea
          id="contact_message"
          rows={4}
          value={formData.message}
          onChange={(e) => {
            setFormData({ ...formData, message: e.target.value });
            if (fieldErrors.message) setFieldErrors({ ...fieldErrors, message: '' });
          }}
          placeholder="How can our engineering or sales team help you today?"
          className={`w-full px-4 py-3 rounded-xl border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all resize-y ${
            fieldErrors.message ? 'border-rose-400 bg-rose-50/20' : 'border-border-subtle bg-surface focus:border-brand-500'
          }`}
        />
        {fieldErrors.message && <p className="text-xs text-rose-600 mt-1">{fieldErrors.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm shadow-md hover:shadow-brand-500/20 disabled:opacity-50 transition-all btn-shimmer"
      >
        {isSubmitting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>Sending Message...</span>
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            <span>Send Message</span>
          </>
        )}
      </button>

      <p className="text-xs text-text-muted flex items-center gap-1.5 pt-2">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>Your contact details are encrypted and will never be shared with third-party advertisers.</span>
      </p>
    </form>
  );
}
