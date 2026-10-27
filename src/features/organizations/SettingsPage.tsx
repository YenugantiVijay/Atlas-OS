import React, { useState, useEffect } from 'react';
import { Save, Database } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseStatus, verifySupabaseConnection, SupabaseVerificationResult } from '@/lib/supabase';

export const SettingsPage: React.FC = () => {
  const { currentOrg, updateOrganization, refreshOrgData } = useOrg();
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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Organization Name is required.');
      return;
    }
    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      updateOrganization(currentOrg.id, {
        name: name.trim(),
        legalName: legalName.trim() || undefined,
        gstin: gstin.trim().toUpperCase() || undefined,
        pan: pan.trim().toUpperCase() || undefined,
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
      refreshOrgData();
    } catch (err: any) {
      showToast('error', 'Failed to save settings', err.message);
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
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Organization Settings
            </h1>
            <Badge variant="violet" size="sm">
              Tenant Profile
            </Badge>
          </div>
          <p className="text-xs text-content-secondary mt-0.5">
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
                  onChange={(e) => setGstin(e.target.value)}
                  placeholder="29ABCDE1234F1Z5"
                />
                <Input
                  label="Permanent Account Number (PAN)"
                  value={pan}
                  onChange={(e) => setPan(e.target.value)}
                  placeholder="ABCDE1234F"
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
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-atlas-600" />
                <CardTitle>Storage & Backend Status</CardTitle>
              </div>
            </CardHeader>
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-surface-panel border border-border">
                <span className="font-semibold block text-content-primary mb-1">
                  Active Data Layer
                </span>
                <Badge variant={supabaseStatus.configured ? 'success' : 'violet'} size="sm">
                  {supabaseStatus.configured ? 'Supabase PostgreSQL' : 'Local Deterministic Ledger'}
                </Badge>
                <p className="text-[11px] text-content-secondary mt-2 leading-relaxed">
                  {supabaseStatus.message}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-surface-panel border border-border">
                <span className="font-semibold block text-content-primary mb-1">
                  Tenant Organization ID
                </span>
                <code className="text-[10px] font-mono text-atlas-700 bg-surface-card p-1 rounded border border-border block truncate">
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
                    className={`mt-2 p-2.5 rounded-lg text-[11px] border leading-relaxed ${
                      verifyResult.status === 'configured_and_reachable'
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                        : 'bg-amber-50 text-amber-900 border-amber-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center justify-between pb-1 border-b border-black/5">
                      <span>
                        {verifyResult.status === 'configured_and_reachable'
                          ? '✓ Client Ready & Auth Reachable'
                          : '⚠ Verification Notice'}
                      </span>
                      {verifyResult.latencyMs !== undefined && (
                        <span className="text-[10px] opacity-75">{verifyResult.latencyMs}ms</span>
                      )}
                    </div>
                    <p className="mt-1">{verifyResult.message}</p>
                    {verifyResult.projectUrl && (
                      <p className="mt-1 font-mono text-[10px] text-content-secondary truncate">
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
    </div>
  );
};
