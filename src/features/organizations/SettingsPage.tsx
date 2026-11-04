import React, { useState, useEffect } from 'react';
import { Save, Database, ShieldCheck } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseStatus, verifySupabaseConnection, SupabaseVerificationResult } from '@/lib/supabase';
import { validateBusinessTaxIdentifiers, maskPan } from '@/lib/validation';
import { BusinessVerificationModal } from './BusinessVerificationModal';

export const SettingsPage: React.FC = () => {
  const {
    currentOrg,
    currentRole,
    eligibility,
    subscription,
    updateOrganization,
    refreshOrgData,
  } = useOrg();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [logoUrl, setLogoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<SupabaseVerificationResult | null>(null);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);

  const isOwner = currentRole === 'owner';

  const handleVerifyConnection = async () => {
    setIsVerifying(true);
    try {
      const result = await verifySupabaseConnection();
      setVerifyResult(result);
      if (result.status === 'configured_and_reachable') {
        showToast('success', 'Supabase Connection Verified', 'Auth endpoint is reachable.');
      } else {
        showToast('warning', 'Supabase Notice', result.message);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', 'Verification Error', msg);
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    if (currentOrg) {
      setName(currentOrg.name || '');
      setLegalName(currentOrg.legalName || '');
      setGstin(currentOrg.gstin || '');
      setPan(currentOrg.pan || '');
      setPhone(currentOrg.phone || '');
      setEmail(currentOrg.email || '');
      setAddressLine1(currentOrg.addressLine1 || '');
      setCity(currentOrg.city || '');
      setState(currentOrg.state || '');
      setPincode(currentOrg.pincode || '');
      setCurrency(currentOrg.currency || 'INR');
      setLogoUrl(currentOrg.logoUrl || '');
    }
  }, [currentOrg]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Organization Name is required.');
      return;
    }
    if (!currentOrg) return;

    // Shared Business Tax Validation
    const taxCheck = validateBusinessTaxIdentifiers({
      gstin: gstin.trim().toUpperCase() || undefined,
      pan: pan.trim().toUpperCase() || undefined,
      requirePan: false,
      allowException: true,
    });

    if (!taxCheck.valid) {
      showToast('error', 'Tax Identifier Error', taxCheck.error || 'Invalid PAN or GSTIN format.');
      return;
    }

    const effectivePan = taxCheck.effectivePan || pan.trim().toUpperCase();
    const effectiveGstin = gstin.trim().toUpperCase();

    setIsSubmitting(true);
    try {
      await updateOrganization(currentOrg.id, {
        name: name.trim(),
        legalName: legalName.trim() || undefined,
        gstin: effectiveGstin || undefined,
        pan: effectivePan || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        pincode: pincode.trim() || undefined,
        currency,
        logoUrl: logoUrl || undefined,
      });

      showToast('success', 'Settings Saved', 'Organization profile updated.');
      await refreshOrgData();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      const sanitized = effectivePan ? msg.replace(new RegExp(effectivePan, 'g'), maskPan(effectivePan)) : msg;
      showToast('error', 'Failed to save settings', sanitized);
    } finally {
      setIsSubmitting(false);
    }
  };

  const supabaseStatus = getSupabaseStatus();

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Organization Settings
            </h1>
            <Badge variant="teal" size="sm">
              Tenant Profile
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Manage your legal entity, Indian GSTIN registration, billing address, and default currency.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Settings Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Distributor Profile & Tax Details</CardTitle>
            </CardHeader>

            <form onSubmit={handleSave} className="space-y-4">
              <ImageUpload
                label="Shop / Business Logo"
                value={logoUrl}
                onChange={setLogoUrl}
                shape="square"
                helperText="Distributor logo for invoices, quotations & header (Optional)"
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Distributor Operating Name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  label="Legal Entity Name"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="GSTIN (15 Digits)"
                  value={gstin}
                  onChange={(e) => {
                    const upper = e.target.value.toUpperCase();
                    setGstin(upper);
                    if (upper.length >= 12 && !pan) {
                      const derived = upper.substring(2, 12);
                      if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(derived)) {
                        setPan(derived);
                      }
                    }
                  }}
                  placeholder="29ABCDE1234F1Z5"
                />
                <Input
                  label="Permanent Account Number (PAN)"
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  helperText={
                    gstin && pan && gstin.substring(2, 12) === pan
                      ? '✓ Matches embedded GSTIN PAN'
                      : undefined
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Business Phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <Input
                  label="Accounts Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <Input
                label="Registered Warehouse / Store Address"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
              />

              <div className="grid grid-cols-3 gap-3">
                <Input
                  label="City"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
                <Input
                  label="State"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                />
                <Input
                  label="PIN Code"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                />
              </div>

              <div className="pt-4 border-t border-border flex justify-end">
                <Button type="submit" variant="primary" isLoading={isSubmitting} leftIcon={<Save className="w-4 h-4" />}>
                  Save Settings
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* Backend & Tenancy Status */}
        <div className="space-y-6">
          {/* Business Verification & Eligibility Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <CardTitle>Business Verification & Status</CardTitle>
              </div>
            </CardHeader>
            <div className="space-y-3.5 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-content-primary">Eligibility Status</span>
                  {(() => {
                    if (!eligibility) {
                      return (
                        <Badge variant="default" showDot size="sm">
                          Undeclared
                        </Badge>
                      );
                    }
                    switch (eligibility.status) {
                      case 'approved':
                        return (
                          <Badge variant="success" showDot size="sm">
                            Approved & Active
                          </Badge>
                        );
                      case 'review_required':
                        return (
                          <Badge variant="warning" showDot size="sm">
                            Pending Review
                          </Badge>
                        );
                      case 'rejected':
                        return (
                          <Badge variant="danger" showDot size="sm">
                            Rejected
                          </Badge>
                        );
                      default:
                        return (
                          <Badge variant="default" showDot size="sm">
                            {eligibility.status}
                          </Badge>
                        );
                    }
                  })()}
                </div>

                {eligibility?.businessCategory && (
                  <div className="text-2xs text-content-secondary">
                    Category: <span className="font-medium text-content-primary">{eligibility.businessCategory}</span>
                  </div>
                )}

                {eligibility?.productLines && eligibility.productLines.length > 0 && (
                  <div className="pt-1">
                    <span className="text-2xs text-content-secondary block mb-1">Declared Product Lines:</span>
                    <div className="flex flex-wrap gap-1">
                      {eligibility.productLines.map((pl) => (
                        <span key={pl} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-2xs font-mono text-content-primary">
                          {pl}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {eligibility?.rejectionReason && (
                  <div className="p-2 rounded bg-rose-50 text-rose-900 border border-rose-200 text-2xs leading-relaxed">
                    <strong>Rejection Reason:</strong> {eligibility.rejectionReason}
                  </div>
                )}
              </div>

              {/* Subscription / Trial Info */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-content-primary">Operational Subscription</span>
                  {(() => {
                    if (!subscription) {
                      return (
                        <Badge variant="default" size="sm">
                          No Subscription
                        </Badge>
                      );
                    }
                    if (subscription.status === 'trialing') {
                      const isExpired = subscription.trialEndsAt && Date.now() > new Date(subscription.trialEndsAt).getTime();
                      return (
                        <Badge variant={isExpired ? 'danger' : 'teal'} size="sm">
                          {isExpired ? 'Trial Expired' : '7-Day Trial'}
                        </Badge>
                      );
                    }
                    if (subscription.status === 'active') {
                      return (
                        <Badge variant="success" size="sm">
                          Active Plan
                        </Badge>
                      );
                    }
                    return (
                      <Badge variant="warning" size="sm">
                        {subscription.status}
                      </Badge>
                    );
                  })()}
                </div>

                {subscription?.trialEndsAt && (
                  <p className="text-2xs text-content-secondary">
                    Trial valid until: {new Date(subscription.trialEndsAt).toLocaleDateString()}
                  </p>
                )}
              </div>

              {/* Complete / Resubmit Verification Action */}
              <div className="pt-1">
                {isOwner ? (
                  <Button
                    type="button"
                    variant={!eligibility || eligibility.status !== 'approved' ? 'primary' : 'outline'}
                    size="sm"
                    className="w-full text-xs font-medium"
                    onClick={() => setIsVerificationModalOpen(true)}
                  >
                    {!eligibility
                      ? 'Complete Business Verification'
                      : eligibility.status === 'rejected'
                      ? 'Resubmit Verification'
                      : 'Update Verification Declaration'}
                  </Button>
                ) : (
                  <p className="text-2xs text-content-secondary italic text-center">
                    Only organization owners can submit or update business eligibility declarations.
                  </p>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-atlas-600" />
                <CardTitle>Storage & Backend Status</CardTitle>
              </div>
            </CardHeader>
            <div className="space-y-3.5 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="font-semibold block text-content-primary mb-1.5">
                  Active Data Layer
                </span>
                <Badge variant={supabaseStatus.configured ? 'success' : 'violet'} showDot size="sm">
                  {supabaseStatus.configured ? 'Supabase PostgreSQL' : 'Local Deterministic Ledger'}
                </Badge>
                <p className="text-xs text-content-secondary mt-2 leading-relaxed">
                  {supabaseStatus.message}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="font-semibold block text-content-primary mb-1">
                  Tenant Organization ID
                </span>
                <code className="text-xs font-mono text-atlas-700 bg-white p-1.5 rounded border border-slate-200 block truncate">
                  {currentOrg?.id}
                </code>
              </div>

              <div className="pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs font-medium"
                  onClick={handleVerifyConnection}
                  disabled={isVerifying}
                >
                  {isVerifying ? 'Checking Auth Endpoint...' : 'Verify Supabase Connection'}
                </Button>
                {verifyResult && (
                  <div
                    className={`mt-2.5 p-3 rounded-lg text-xs border leading-relaxed ${
                      verifyResult.status === 'configured_and_reachable'
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                        : 'bg-amber-50 text-amber-900 border-amber-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center justify-between pb-1.5 border-b border-black/5">
                      <span>
                        {verifyResult.status === 'configured_and_reachable'
                          ? '✓ Client Ready & Auth Reachable'
                          : '⚠ Verification Notice'}
                      </span>
                      {verifyResult.latencyMs !== undefined && (
                        <span className="text-xs opacity-75">{verifyResult.latencyMs}ms</span>
                      )}
                    </div>
                    <p className="mt-1.5">{verifyResult.message}</p>
                    {verifyResult.projectUrl && (
                      <p className="mt-1 font-mono text-xs text-content-secondary truncate">
                        Endpoint: {verifyResult.projectUrl}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Business Verification Modal */}
      <BusinessVerificationModal
        isOpen={isVerificationModalOpen}
        onClose={() => setIsVerificationModalOpen(false)}
      />
    </div>
  );
};
