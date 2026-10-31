import React, { useState, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  Building2,
  ArrowRight,
  AlertCircle,
  LogOut,
  ShieldCheck,
  MapPin,
  Phone,
  RotateCcw,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';

function getInitials(name?: string | null): string {
  if (!name || !name.trim() || name.trim().toLowerCase() === 'user') return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

export const OnboardingPage: React.FC = () => {
  const {
    currentUser,
    currentOrg,
    organizations,
    isAuthenticated,
    isDemoMode,
    isLoadingAuth,
    authError,
    createOrganization,
    refreshOrgData,
    signOut,
  } = useOrg();

  const navigate = useNavigate();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [phone, setPhone] = useState('+91 ');
  const [email, setEmail] = useState(() => currentUser?.email || '');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [idempotencyConflict, setIdempotencyConflict] = useState(false);

  // Maintain one attempt-scoped idempotency key across retries for the same logical attempt
  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'atlas-onboard-' + Date.now()
  );

  // 1. Loading state while authentication or organizations are loading
  if (isLoadingAuth) {
    return (
      <div className="min-h-screen bg-surface-canvas flex items-center justify-center">
        <div className="flex flex-col items-center gap-3.5 text-atlas-600 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-atlas-100 flex items-center justify-center border border-atlas-200 shadow-xs">
            <Loader2 className="w-6 h-6 animate-spin text-atlas-600" />
          </div>
          <span className="text-xs font-semibold tracking-wide text-content-secondary">
            Loading your profile...
          </span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated or Demo users must not enter cloud onboarding
  if (!isAuthenticated || isDemoMode) {
    return <Navigate to="/" replace />;
  }

  // 3. Organization loading failure (State 4) — show recoverable error rather than letting user create duplicate org
  if (authError) {
    return (
      <div className="min-h-screen bg-surface-canvas flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface-card rounded-2xl border border-border shadow-xl p-6 sm:p-8 text-center animate-in fade-in zoom-in-95 duration-200">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto mb-4 shadow-2xs">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-content-primary mb-2">
            Unable to Verify Organizations
          </h2>
          <p className="text-xs text-content-secondary mb-6 leading-relaxed">
            {authError}
          </p>
          <div className="flex flex-col gap-2.5">
            <Button
              variant="primary"
              onClick={() => refreshOrgData()}
              className="w-full justify-center"
              leftIcon={<RotateCcw className="w-4 h-4" />}
            >
              Retry Connection
            </Button>
            <Button
              variant="secondary"
              onClick={() => signOut()}
              className="w-full justify-center"
              leftIcon={<LogOut className="w-4 h-4" />}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 4. Existing users with at least one active organization go directly to the dashboard
  if (organizations.length > 0 || currentOrg) {
    return <Navigate to="/" replace />;
  }

  const handleGstinChange = (value: string) => {
    const upper = value.toUpperCase();
    setGstin(upper);

    // Auto-derive 10-character PAN from Indian GSTIN (characters 3 through 12)
    if (upper.length >= 12 && !pan) {
      const derived = upper.substring(2, 12);
      if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(derived)) {
        setPan(derived);
      }
    }
  };

  const handleRefreshKey = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      idempotencyKeyRef.current = crypto.randomUUID();
    } else {
      idempotencyKeyRef.current = 'atlas-onboard-' + Date.now();
    }
    setIdempotencyConflict(false);
    setErrorMessage(null);
    showToast('info', 'Submission Key Reset', 'Ready to retry organization creation.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || idempotencyConflict) return;

    setErrorMessage(null);

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setErrorMessage('Please enter a valid distributor business name (at least 2 characters).');
      return;
    }

    const trimmedGstin = gstin.trim().toUpperCase();
    let effectivePan = pan.trim().toUpperCase();
    if (!effectivePan && trimmedGstin.length >= 12) {
      const derived = trimmedGstin.substring(2, 12);
      if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(derived)) {
        effectivePan = derived;
      }
    }

    if (trimmedGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(trimmedGstin)) {
      setErrorMessage('Invalid GSTIN format. Expected 15-character format (e.g. 29ABCDE1234F1Z5).');
      return;
    }

    if (effectivePan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(effectivePan)) {
      setErrorMessage('Invalid PAN format. Expected 10-character format (e.g. ABCDE1234F).');
      return;
    }

    setIsSubmitting(true);

    try {
      const created = await createOrganization({
        name: trimmedName,
        legalName: legalName.trim() || undefined,
        gstin: trimmedGstin || undefined,
        pan: effectivePan || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        pincode: pincode.trim() || undefined,
        currency: 'INR',
        idempotencyKey: idempotencyKeyRef.current,
      });

      showToast(
        'success',
        'Organization Ready',
        `Welcome to Atlas OS! Your workspace for ${created.name} is now active.`
      );

      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ERR_IDEMPOTENCY_CONFLICT')) {
        setIdempotencyConflict(true);
        setErrorMessage(
          'A submission conflict occurred because details changed between attempts. Please click "Reset Submission Key" below to proceed.'
        );
      } else {
        setErrorMessage(msg);
        showToast('error', 'Creation Failed', msg);
      }
      // Note: User form values are preserved in state for safe retry
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-surface-canvas text-content-primary flex flex-col justify-between">
      {/* Top Navigation Bar */}
      <header className="border-b border-border bg-surface-card px-4 sm:px-8 py-3.5 flex items-center justify-between sticky top-0 z-20 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-atlas-600 to-atlas-800 flex items-center justify-center text-white font-bold shadow-xs">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-content-primary">
                ATLAS OS
              </span>
              <Badge variant="teal" size="sm">
                Onboarding
              </Badge>
            </div>
            <span className="text-[11px] text-content-muted hidden sm:inline">
              Step 2 of 2: Create Business Organization
            </span>
          </div>
        </div>

        {/* User Identity Chip & Escape Action */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-panel border border-border text-xs">
            <div className="w-5 h-5 rounded-full bg-atlas-100 text-atlas-700 font-semibold flex items-center justify-center text-[10px]">
              {getInitials(currentUser?.fullName)}
            </div>
            <span className="font-medium text-content-secondary max-w-[120px] sm:max-w-[180px] truncate">
              {currentUser?.fullName || currentUser?.email}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="text-xs text-content-secondary hover:text-rose-600"
            title="Sign out of current account"
          >
            <LogOut className="w-3.5 h-3.5 sm:mr-1" />
            <span className="hidden sm:inline">Sign Out</span>
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-3xl mx-auto px-4 py-8 sm:py-12 w-full animate-in fade-in duration-300">
        <div className="space-y-6">
          {/* Welcome & Instruction Banner */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-atlas-50 border border-atlas-200 text-atlas-700 text-xs font-semibold mb-1">
              <Sparkles className="w-3.5 h-3.5 text-atlas-600" />
              Primary Business Workspace Setup
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-content-primary">
              Set Up Your Distributor Organization
            </h1>
            <p className="text-xs sm:text-sm text-content-secondary max-w-xl mx-auto leading-relaxed">
              Atlas OS organizes all inventory items, sales orders, GST tax invoices, and team access
              within dedicated organization workspaces. Enter your firm details to begin.
            </p>
          </div>

          {/* Form Card */}
          <Card className="border border-border shadow-modal bg-surface-card p-6 sm:p-8">
            {/* Error Message Alert */}
            {errorMessage && (
              <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3 animate-in fade-in">
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
                <div className="space-y-1.5 flex-1 leading-relaxed">
                  <span className="font-semibold block">Organization Setup Issue</span>
                  <p>{errorMessage}</p>
                  {idempotencyConflict && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 text-xs border-rose-300 bg-white hover:bg-rose-50"
                      onClick={handleRefreshKey}
                      leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                    >
                      Reset Submission Key
                    </Button>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Section 1: Business Identity */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <Building2 className="w-4 h-4 text-atlas-600" />
                  <span className="text-xs font-bold uppercase tracking-wider text-content-secondary">
                    1. Business Identity
                  </span>
                </div>

                <div className="space-y-4">
                  <Input
                    label="Distributor Business Name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Sri Lakshmi Electrical Distributors"
                    disabled={isSubmitting}
                    helperText="This name will appear on all quotations, sales orders, and invoices."
                  />

                  <Input
                    label="Legal Entity Name"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="e.g. Sri Lakshmi Electricals & Co. Pvt Ltd"
                    disabled={isSubmitting}
                    helperText="Official registered company name (optional if identical to business name)."
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="GSTIN (15 characters)"
                      value={gstin}
                      onChange={(e) => handleGstinChange(e.target.value)}
                      placeholder="29ABCDE1234F1Z5"
                      maxLength={15}
                      disabled={isSubmitting}
                      helperText="Standard Indian Goods & Services Tax Identification Number."
                    />

                    <Input
                      label="PAN (10 characters)"
                      value={pan}
                      onChange={(e) => setPan(e.target.value.toUpperCase())}
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      disabled={isSubmitting}
                      helperText="Auto-derived from GSTIN or enter manually."
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Contact Details */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <Phone className="w-4 h-4 text-atlas-600" />
                  <span className="text-xs font-bold uppercase tracking-wider text-content-secondary">
                    2. Business Contact
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Primary Phone Number"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    disabled={isSubmitting}
                  />

                  <Input
                    label="Billing / Business Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="billing@distributor.com"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Section 3: Operating Warehouse / Billing Address */}
              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <MapPin className="w-4 h-4 text-atlas-600" />
                  <span className="text-xs font-bold uppercase tracking-wider text-content-secondary">
                    3. Warehouse & Billing Location
                  </span>
                </div>

                <div className="space-y-4">
                  <Input
                    label="Street / Shop / Warehouse Address"
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    placeholder="e.g. Plot 42, Phase II, Peenya Industrial Area"
                    disabled={isSubmitting}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Input
                      label="City"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g. Bangalore"
                      disabled={isSubmitting}
                    />

                    <Input
                      label="State"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="e.g. Karnataka"
                      disabled={isSubmitting}
                    />

                    <Input
                      label="PIN Code"
                      value={pincode}
                      onChange={(e) => setPincode(e.target.value)}
                      placeholder="560058"
                      maxLength={10}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Operational Defaults */}
              <div className="p-3.5 rounded-xl bg-surface-panel border border-border flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-atlas-600 shrink-0" />
                  <div>
                    <span className="font-semibold text-content-primary block">
                      Operating Currency & Tax Standards
                    </span>
                    <span className="text-content-muted">
                      Configured for Indian GST compliance & INR transactions.
                    </span>
                  </div>
                </div>
                <Badge variant="default" size="sm" className="font-bold shrink-0">
                  INR (₹)
                </Badge>
              </div>

              {/* Primary Action Button */}
              <div className="pt-4">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full py-3 text-sm font-semibold shadow-md"
                  isLoading={isSubmitting}
                  disabled={isSubmitting || idempotencyConflict}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Create My Organization
                </Button>
                <p className="text-[11px] text-content-muted text-center mt-2.5">
                  You will automatically be assigned as the primary <strong>owner</strong> of this organization.
                </p>
              </div>
            </form>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 text-center text-xs text-content-muted">
        ATLAS OS Enterprise • Statutory Indian Electricals ERP • Multi-Tenant Architecture
      </footer>
    </div>
  );
};
