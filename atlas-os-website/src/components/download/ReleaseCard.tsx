import React, { useRef, useState } from 'react';
import TurnstileWidget from '../common/TurnstileWidget';
import { getOrCreateRequestId, leadDeliveryConfigured, submitWebsiteLead } from '../../lib/websiteLeads';
import {
  Monitor,
  CheckCircle2,
  Clock,
  Shield,
  ArrowRight,
  Bell,
} from 'lucide-react';
import type { ReleaseManifest } from '../../types';

interface ReleaseCardProps {
  release: ReleaseManifest;
  webAppUrl?: string;
}

export default function ReleaseCard({ release, webAppUrl }: ReleaseCardProps) {
  const [notifyEmail, setNotifyEmail] = useState('');
  const [isNotified, setIsNotified] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [resetCounter, setResetCounter] = useState(0);
  const requestRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const handleNotifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      const data = { email: notifyEmail.trim() };
      const request = getOrCreateRequestId(requestRef.current, data);
      requestRef.current = request;
      await submitWebsiteLead('release', data, turnstileToken, request.requestId);
      setIsNotified(true);
      requestRef.current = null;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to register your email.');
      setTurnstileToken('');
      setResetCounter((n) => n + 1);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-3xl border border-border bg-white shadow-xl overflow-hidden transition-all duration-200">
      {/* Header Banner */}
      <div className="p-6 sm:p-8 bg-surface-dark text-white border-b border-border/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="p-3.5 rounded-2xl bg-brand-600/30 text-brand-400 border border-brand-500/30">
            <Monitor className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h2 className="text-2xl font-bold font-display text-white">Atlas OS for {release.platform}</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Packaging Preview
              </span>
            </div>
            <p className="text-sm text-content-muted">
              Official 64-bit desktop application for high-speed billing counters and wholesale warehouses.
            </p>
          </div>
        </div>

        {/* Release Meta Pill */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-content-muted font-mono">
          <span className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
            Version: <strong className="text-white">{release.version}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
            Target OS: <strong className="text-white">{release.platformLabel}</strong>
          </span>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="p-6 sm:p-8 space-y-8">
        {/* Genuine Status Callout */}
        <div className="p-5 rounded-2xl bg-brand-50/70 border border-brand-200 space-y-2">
          <div className="flex items-center gap-2 text-brand-900 font-bold text-sm">
            <Clock className="w-4 h-4 text-brand-600 shrink-0" />
            <span>Standalone Windows Desktop Package In Active Development</span>
          </div>
          <p className="text-xs text-brand-800 leading-relaxed">
            In accordance with our strict product integrity guidelines, we do not provide mock <code>.exe</code> or{' '}
            <code>.msi</code> installer binaries. Atlas OS is currently active as an enterprise web application. A
            dedicated standalone desktop package featuring native thermal receipt printing and COM-port barcode
            integration is undergoing final certification.
          </p>
        </div>

        {/* Specifications Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Release Specifications */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-content-secondary font-display">
              Package Metadata
            </h3>
            <div className="rounded-xl border border-border bg-surface-secondary divide-y divide-border text-xs">
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-content-secondary">Distribution Status:</span>
                <span className="font-semibold text-amber-700 bg-amber-100/70 px-2 py-0.5 rounded-md">
                  Preview / Packaging
                </span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-content-secondary">Digital Signature:</span>
                <span className="text-content-secondary flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-content-muted" /> In Verification Pipeline
                </span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-content-secondary">Installer Architecture:</span>
                <span className="font-mono text-content-primary">Native x64 Desktop Wrapper</span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-content-secondary">SHA-256 Checksum:</span>
                <span className="font-mono text-[11px] text-content-muted">Published with signed binary</span>
              </div>
            </div>
          </div>

          {/* Minimum Requirements */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-content-secondary font-display">
              Minimum System Requirements
            </h3>
            <div className="rounded-xl border border-border bg-surface-secondary divide-y divide-border text-xs">
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-content-secondary">Operating System:</span>
                <span className="font-medium text-content-primary">{release.minimumRequirements.os}</span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-content-secondary">Processor & Architecture:</span>
                <span className="font-medium text-content-primary">{release.minimumRequirements.processor}</span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-content-secondary">System Memory (RAM):</span>
                <span className="font-medium text-content-primary">{release.minimumRequirements.ram}</span>
              </div>
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-content-secondary">Display Resolution:</span>
                <span className="font-medium text-content-primary">{release.minimumRequirements.display}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Release Notes */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-content-secondary font-display">
            Desktop Packaging Capabilities Under Preparation
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {release.releaseNotes.map((note, idx) => (
              <li key={idx} className="flex items-start gap-2 p-2.5 rounded-xl border border-border bg-surface-secondary/40">
                <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                <span className="text-content-primary leading-normal">{note}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Action Panel: Notification Signup or Web App Launch */}
        <div className="pt-4 border-t border-border flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="w-full md:w-auto space-y-1">
            <p className="text-sm font-bold font-display text-content-primary">
              Be Notified The Moment Windows Desktop Launches
            </p>
            <p className="text-xs text-content-secondary">
              Receive a secure download link and release checklist as soon as the verified installer is published.
            </p>
          </div>

          <div className="w-full md:w-auto">
            {isNotified ? (
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Your notification request was accepted for email delivery.</span>
              </div>
            ) : (
              <form onSubmit={handleNotifySubmit} className="flex flex-col gap-2">
                {errorMessage && <p role="alert" className="max-w-xs text-xs text-rose-700">{errorMessage}</p>}
                <input
                  type="email"
                  required
                  placeholder="Enter work email..."
                  value={notifyEmail}
                  onChange={(e) => setNotifyEmail(e.target.value)}
                  className="h-11 px-3.5 text-xs rounded-xl border border-border bg-surface-secondary text-content-primary placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-600 w-60"
                />
                <TurnstileWidget action="lead_release" onToken={setTurnstileToken} resetCounter={resetCounter} />
                {!leadDeliveryConfigured && <p role="status" className="text-xs text-amber-800">Release notifications are not configured yet.</p>}
                <button
                  type="submit"
                  disabled={isSubmitting || !leadDeliveryConfigured || !turnstileToken}
                  className="h-11 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all duration-200 cursor-pointer shrink-0 btn-shimmer"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Sending...' : 'Notify Me'}</span>
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Web Application Alternative */}
        <div className="p-4 rounded-2xl border border-border bg-surface-secondary flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div className="space-y-0.5 text-center sm:text-left">
            <span className="font-semibold text-content-primary">Need immediate wholesale billing access?</span>
            <p className="text-content-secondary">
              Experience the full Atlas OS ERP platform right now via our live web application.
            </p>
          </div>
          <a
            href={webAppUrl || '/request-demo'}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-brand-200 text-brand-700 font-semibold hover:bg-brand-50 transition-colors shrink-0 shadow-2xs"
          >
            <span>{webAppUrl ? 'Launch Web Application' : 'Request Demo Access'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
