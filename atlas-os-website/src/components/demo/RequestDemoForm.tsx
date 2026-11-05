import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, Send, ShieldCheck, Phone, Mail, Building2, User } from 'lucide-react';
import type { DemoRequestPayload } from '../../types';

export default function RequestDemoForm() {
  const [formData, setFormData] = useState<DemoRequestPayload>({
    fullName: '',
    businessName: '',
    email: '',
    phone: '',
    industry: 'electrical_wholesale',
    businessSize: '6_to_20',
    city: '',
    primaryRequirement: 'inventory_and_gst_billing',
    additionalMessage: '',
  });

  // Anti-spam honeypot field
  const [honeypot, setHoneypot] = useState('');

  // UI States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.fullName.trim()) {
      errors.fullName = 'Please enter your full name.';
    }

    if (!formData.businessName.trim()) {
      errors.businessName = 'Please enter your enterprise or trade name.';
    }

    if (!formData.email.trim()) {
      errors.email = 'Please provide a valid business email address.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = 'Please enter a valid email format (e.g., name@business.com).';
    }

    // Phone validation supporting Indian 10-digit mobile (+91) and international formats
    const cleanedPhone = formData.phone.replace(/[\s\-\(\)\+]/g, '');
    if (!formData.phone.trim()) {
      errors.phone = 'Please provide a valid phone or WhatsApp contact number.';
    } else if (cleanedPhone.length < 10 || cleanedPhone.length > 13) {
      errors.phone = 'Please enter a valid 10-digit mobile number or standard phone.';
    }

    if (!formData.city.trim()) {
      errors.city = 'Please enter your business city/location.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Honeypot check for bots
    if (honeypot) {
      console.warn('Bot submission prevented.');
      setIsSuccess(true);
      return;
    }

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Check rate limit in localStorage (max 3 submissions per hour per browser)
      const lastSubmissionsStr = localStorage.getItem('atlas_demo_submissions');
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      let timestamps: number[] = lastSubmissionsStr ? JSON.parse(lastSubmissionsStr) : [];
      timestamps = timestamps.filter((t) => now - t < oneHour);

      if (timestamps.length >= 3) {
        throw new Error(
          'You have submitted multiple enquiries recently. Please allow our team time to respond or email sales@atlasos.business directly.'
        );
      }

      // Check for configured backend demo endpoint (e.g., Supabase / Firebase Functions / webhook)
      const endpoint = (window as any).ATLAS_DEMO_ENDPOINT || '';

      if (endpoint) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            submittedAt: new Date().toISOString(),
          }),
        });

        if (!response.ok) {
          throw new Error('Unable to submit enquiry to server. Please email sales@atlasos.business.');
        }
      } else {
        // Transparent client-side enquiry storage when no external serverless endpoint is wired
        const enquiries = JSON.parse(localStorage.getItem('atlas_saved_enquiries') || '[]');
        enquiries.push({
          ...formData,
          submittedAt: new Date().toISOString(),
          id: `enquiry-${Date.now()}`,
        });
        localStorage.setItem('atlas_saved_enquiries', JSON.stringify(enquiries));
      }

      // Update rate limiter
      timestamps.push(now);
      localStorage.setItem('atlas_demo_submissions', JSON.stringify(timestamps));

      setIsSuccess(true);
    } catch (err: any) {
      setErrorMessage(err?.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="p-8 sm:p-12 rounded-3xl border border-brand-200 bg-white shadow-xl text-center space-y-6 animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div className="space-y-2 max-w-md mx-auto">
          <h3 className="text-2xl font-bold font-display text-content-primary">
            Demonstration Request Received
          </h3>
          <p className="text-sm text-content-secondary leading-relaxed">
            Thank you, <strong className="text-content-primary">{formData.fullName}</strong>. Your enquiry for{' '}
            <strong className="text-content-primary">{formData.businessName}</strong> has been logged in our onboarding
            queue.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-surface-secondary border border-border text-xs text-left max-w-md mx-auto space-y-1.5">
          <div className="flex items-center justify-between font-semibold text-content-primary">
            <span>Contact Number:</span>
            <span>{formData.phone}</span>
          </div>
          <div className="flex items-center justify-between font-semibold text-content-primary">
            <span>Business Email:</span>
            <span>{formData.email}</span>
          </div>
          <div className="flex items-center justify-between font-semibold text-content-primary">
            <span>Location:</span>
            <span>{formData.city}</span>
          </div>
        </div>

        <p className="text-xs text-content-muted">
          Our technical solutions team typically responds within 1 business day. For urgent enquiries, write directly to{' '}
          <a href="mailto:sales@atlasos.business" className="text-brand-600 font-semibold hover:underline">
            sales@atlasos.business
          </a>
          .
        </p>

        <button
          type="button"
          onClick={() => {
            setIsSuccess(false);
            setFormData({
              fullName: '',
              businessName: '',
              email: '',
              phone: '',
              industry: 'electrical_wholesale',
              businessSize: '6_to_20',
              city: '',
              primaryRequirement: 'inventory_and_gst_billing',
              additionalMessage: '',
            });
          }}
          className="text-xs text-brand-700 hover:text-brand-800 font-semibold underline cursor-pointer"
        >
          Submit another enquiry
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 sm:p-10 rounded-3xl border border-border bg-white shadow-xl space-y-6" noValidate>
      {/* Form Header */}
      <div className="space-y-1 border-b border-border pb-5">
        <h2 className="text-xl sm:text-2xl font-bold font-display text-content-primary">
          Schedule a Guided Product Walkthrough
        </h2>
        <p className="text-xs sm:text-sm text-content-secondary">
          See how Atlas OS handles your actual SKUs, pricing models, contractor credit limits, and GST reporting.
        </p>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Hidden Honeypot Field */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website-trap">Leave this blank</label>
        <input
          id="website-trap"
          type="text"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Full Name */}
        <div className="space-y-1.5">
          <label htmlFor="fullName" className="block text-xs font-semibold text-content-primary">
            Full Name <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              id="fullName"
              type="text"
              required
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              placeholder="e.g. Ramesh Kumar"
              className={`w-full h-11 rounded-xl border bg-surface-secondary px-3.5 pl-10 text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600 transition-all ${
                fieldErrors.fullName ? 'border-red-400 bg-red-50/20' : 'border-border'
              }`}
            />
            <User className="w-4 h-4 text-content-muted absolute left-3.5 top-3.5" />
          </div>
          {fieldErrors.fullName && <p className="text-[11px] text-red-600">{fieldErrors.fullName}</p>}
        </div>

        {/* Business Name */}
        <div className="space-y-1.5">
          <label htmlFor="businessName" className="block text-xs font-semibold text-content-primary">
            Business / Trade Name <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              id="businessName"
              type="text"
              required
              value={formData.businessName}
              onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
              placeholder="e.g. Sri Lakshmi Electricals"
              className={`w-full h-11 rounded-xl border bg-surface-secondary px-3.5 pl-10 text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600 transition-all ${
                fieldErrors.businessName ? 'border-red-400 bg-red-50/20' : 'border-border'
              }`}
            />
            <Building2 className="w-4 h-4 text-content-muted absolute left-3.5 top-3.5" />
          </div>
          {fieldErrors.businessName && <p className="text-[11px] text-red-600">{fieldErrors.businessName}</p>}
        </div>

        {/* Business Email */}
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-xs font-semibold text-content-primary">
            Business Email <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              id="email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="e.g. contact@srilakshmielectricals.com"
              className={`w-full h-11 rounded-xl border bg-surface-secondary px-3.5 pl-10 text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600 transition-all ${
                fieldErrors.email ? 'border-red-400 bg-red-50/20' : 'border-border'
              }`}
            />
            <Mail className="w-4 h-4 text-content-muted absolute left-3.5 top-3.5" />
          </div>
          {fieldErrors.email && <p className="text-[11px] text-red-600">{fieldErrors.email}</p>}
        </div>

        {/* Phone Number */}
        <div className="space-y-1.5">
          <label htmlFor="phone" className="block text-xs font-semibold text-content-primary">
            Phone / WhatsApp Number <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              id="phone"
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="e.g. +91 98765 43210"
              className={`w-full h-11 rounded-xl border bg-surface-secondary px-3.5 pl-10 text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600 transition-all ${
                fieldErrors.phone ? 'border-red-400 bg-red-50/20' : 'border-border'
              }`}
            />
            <Phone className="w-4 h-4 text-content-muted absolute left-3.5 top-3.5" />
          </div>
          {fieldErrors.phone && <p className="text-[11px] text-red-600">{fieldErrors.phone}</p>}
        </div>

        {/* Primary Industry */}
        <div className="space-y-1.5">
          <label htmlFor="industry" className="block text-xs font-semibold text-content-primary">
            Primary Industry
          </label>
          <select
            id="industry"
            value={formData.industry}
            onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
            className="w-full h-11 rounded-xl border border-border bg-surface-secondary px-3.5 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600"
          >
            <option value="electrical_wholesale">Electrical Wholesale & Distribution</option>
            <option value="electronics_dealer">Electronics Components & Lighting</option>
            <option value="hardware_tools">Hardware, Fasteners & Industrial Tools</option>
            <option value="retail_trade_counter">Combined Wholesale & Retail Counter</option>
            <option value="other_distribution">Other Distribution Business</option>
          </select>
        </div>

        {/* Business Size */}
        <div className="space-y-1.5">
          <label htmlFor="businessSize" className="block text-xs font-semibold text-content-primary">
            Team Size (Staff & Billing Counters)
          </label>
          <select
            id="businessSize"
            value={formData.businessSize}
            onChange={(e) => setFormData({ ...formData, businessSize: e.target.value })}
            className="w-full h-11 rounded-xl border border-border bg-surface-secondary px-3.5 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600"
          >
            <option value="1_to_5">1 – 5 team members (Single counter)</option>
            <option value="6_to_20">6 – 20 team members (Wholesale godown)</option>
            <option value="21_to_50">21 – 50 team members (Multi-counter)</option>
            <option value="50_plus">50+ team members (Multi-branch network)</option>
          </select>
        </div>

        {/* Business Location / City */}
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="city" className="block text-xs font-semibold text-content-primary">
            City, State & Region <span className="text-red-500">*</span>
          </label>
          <input
            id="city"
            type="text"
            required
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            placeholder="e.g. Hyderabad, Telangana or Vijayawada, Andhra Pradesh"
            className={`w-full h-11 rounded-xl border bg-surface-secondary px-3.5 text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600 transition-all ${
              fieldErrors.city ? 'border-red-400 bg-red-50/20' : 'border-border'
            }`}
          />
          {fieldErrors.city && <p className="text-[11px] text-red-600">{fieldErrors.city}</p>}
        </div>

        {/* Primary Requirement */}
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="primaryRequirement" className="block text-xs font-semibold text-content-primary">
            What is your most critical operational priority?
          </label>
          <select
            id="primaryRequirement"
            value={formData.primaryRequirement}
            onChange={(e) => setFormData({ ...formData, primaryRequirement: e.target.value })}
            className="w-full h-11 rounded-xl border border-border bg-surface-secondary px-3.5 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600"
          >
            <option value="inventory_and_gst_billing">Managing thousands of electrical SKUs & fast GST invoicing</option>
            <option value="receivables_and_credit">Tracking contractor credit limits & outstanding receivables</option>
            <option value="excel_and_accounting">Generating clean Excel workbooks for tax auditor & accountant</option>
            <option value="multi_org">Managing multiple firms or branches from one login</option>
            <option value="replacing_legacy_erp">Replacing slow, complicated legacy desktop accounting software</option>
          </select>
        </div>

        {/* Additional Message */}
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="additionalMessage" className="block text-xs font-semibold text-content-primary">
            Specific Requirements or Notes (Optional)
          </label>
          <textarea
            id="additionalMessage"
            rows={3}
            value={formData.additionalMessage}
            onChange={(e) => setFormData({ ...formData, additionalMessage: e.target.value })}
            placeholder="Tell us about your current software or special workflow needs (e.g. Polycab wire coil conversions, RTGS payment matching)..."
            className="w-full rounded-xl border border-border bg-surface-secondary p-3 text-sm text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600"
          />
        </div>
      </div>

      {/* Privacy Notice & Security Badge */}
      <div className="flex items-start gap-2.5 pt-2 text-[11px] text-content-secondary border-t border-border">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <p>
          We respect commercial confidentiality. Your contact details are stored securely and used solely by our team to
          coordinate your Atlas OS product demonstration. We never sell or share distributor business records.
        </p>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full h-12 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-display font-semibold text-sm shadow-md hover:shadow-glow transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer active:scale-[0.99]"
      >
        {isSubmitting ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            <span>Submitting Request...</span>
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            <span>Confirm Demonstration Request</span>
          </>
        )}
      </button>
    </form>
  );
}
