import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertCircle,
  Building2,
  Check,
  Plus,
  X,
  FileCheck,
  Lock,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { BusinessCategory } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import {
  validateBusinessTaxIdentifiers,
  maskPan,
} from '@/lib/validation';

const SUGGESTED_PRODUCT_LINES = [
  'Wires & Cables',
  'Switches & Sockets',
  'Switchgear & Protection',
  'LED Lighting',
  'Fans & Ventilation',
  'Conduits & PVC Fittings',
  'Motors & Starters',
  'Solar & Inverter Equipment',
];

interface BusinessVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BusinessVerificationModal: React.FC<BusinessVerificationModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    currentOrg,
    currentRole,
    eligibility,
    updateOrganization,
    declareEligibility,
    refreshOrgData,
  } = useOrg();

  const { showToast } = useToast();

  const isOwner = currentRole === 'owner';

  // Form states
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');

  // Eligibility states
  const [businessCategory, setBusinessCategory] =
    useState<BusinessCategory>('electrical_wholesale_distributor');
  const [sellsElectricalProducts, setSellsElectricalProducts] = useState(true);
  const [productLines, setProductLines] = useState<string[]>([
    'Wires & Cables',
    'Switches & Sockets',
    'Switchgear & Protection',
  ]);
  const [customTagInput, setCustomTagInput] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Sync with current organization and existing eligibility
  useEffect(() => {
    if (currentOrg) {
      setLegalName(currentOrg.legalName || currentOrg.name || '');
      setGstin(currentOrg.gstin || '');
      setPan(currentOrg.pan || '');
      setPhone(currentOrg.phone || '');
      setAddressLine1(currentOrg.addressLine1 || '');
      setCity(currentOrg.city || '');
      setState(currentOrg.state || '');
      setPincode(currentOrg.pincode || '');
    }

    if (eligibility) {
      setBusinessCategory(eligibility.businessCategory || 'electrical_wholesale_distributor');
      setSellsElectricalProducts(eligibility.sellsElectricalProducts ?? true);
      if (eligibility.productLines && eligibility.productLines.length > 0) {
        setProductLines(eligibility.productLines);
      }
    }
  }, [currentOrg, eligibility, isOpen]);

  const handleGstinChange = (value: string) => {
    const upper = value.toUpperCase();
    setGstin(upper);

    // Auto-derive PAN if not already manually specified
    if (upper.length >= 12 && !pan) {
      const derived = upper.substring(2, 12);
      if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(derived)) {
        setPan(derived);
      }
    }
  };

  const toggleProductLine = (item: string) => {
    setProductLines((prev) =>
      prev.includes(item) ? prev.filter((p) => p !== item) : [...prev, item]
    );
  };

  const addCustomTag = () => {
    const trimmed = customTagInput.trim();
    if (trimmed && !productLines.includes(trimmed)) {
      setProductLines((prev) => [...prev, trimmed]);
      setCustomTagInput('');
    }
  };

  const removeProductLine = (item: string) => {
    setProductLines((prev) => prev.filter((p) => p !== item));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg) return;
    setFormError(null);

    if (!isOwner) {
      setFormError('Only organization owners can submit or update business eligibility declarations.');
      return;
    }

    // 1. Tax Identifiers Validation (Shared PAN / GSTIN cross-matching)
    const taxValidation = validateBusinessTaxIdentifiers({
      gstin: gstin.trim().toUpperCase() || undefined,
      pan: pan.trim().toUpperCase() || undefined,
      requirePan: true,
      allowException: false,
    });

    if (!taxValidation.valid) {
      setFormError(taxValidation.error || 'Invalid business tax identifiers.');
      return;
    }

    const effectivePan = taxValidation.effectivePan || pan.trim().toUpperCase();
    const effectiveGstin = gstin.trim().toUpperCase();

    // 2. Address & Contact validation
    if (!phone.trim()) {
      setFormError('A valid business contact phone number is required.');
      return;
    }

    if (!addressLine1.trim() || !city.trim() || !state.trim()) {
      setFormError('Complete registered business address (Street, City, State) is required.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 3. Update organization record details
      await updateOrganization(currentOrg.id, {
        legalName: legalName.trim() || currentOrg.name,
        gstin: effectiveGstin || undefined,
        pan: effectivePan || undefined,
        phone: phone.trim(),
        addressLine1: addressLine1.trim(),
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim() || undefined,
      });

      // 4. Submit self-declaration via authorized server RPC
      const result = await declareEligibility({
        businessCategory,
        sellsElectricalProducts,
        productLines,
      });

      await refreshOrgData();

      if (result.status === 'approved') {
        showToast(
          'success',
          'Business Verification Approved',
          'Your electrical distribution business is verified. Operational writes and 7-day trial are now active.'
        );
        onClose();
      } else if (result.status === 'review_required') {
        showToast(
          'warning',
          'Verification Queued for Review',
          result.reviewerNotes ||
            'Your declaration has been recorded and queued for manual compliance review.'
        );
        onClose();
      } else if (result.status === 'rejected') {
        showToast(
          'error',
          'Business Verification Rejected',
          result.rejectionReason ||
            'This business declaration does not meet the eligibility requirements for ATLAS OS.'
        );
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Ensure PAN is redacted if it inadvertently appears in any error message
      const sanitizedMsg = effectivePan
        ? msg.replace(new RegExp(effectivePan, 'g'), maskPan(effectivePan))
        : msg;
      setFormError(sanitizedMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Complete Business Verification"
      description="Declare your business category, tax identifiers, and electrical product lines to activate operational features."
    >
      {!isOwner ? (
        <div className="space-y-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          <div className="flex items-center gap-2 font-semibold">
            <Lock className="w-4 h-4 text-amber-600" />
            <span>Owner Authorization Required</span>
          </div>
          <p className="leading-relaxed">
            Only designated organization owners can submit or update statutory business eligibility declarations. Please contact your organization owner to complete this verification.
          </p>
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5 animate-in fade-in"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{formError}</div>
            </div>
          )}

          {/* Business Entity Details */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-content-primary">
              <Building2 className="w-4 h-4 text-atlas-600" />
              <span>Distributor Identity & Tax Credentials</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Legal Business Name"
                required
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="e.g. Vijay Electronics Pvt Ltd"
                disabled={isSubmitting}
              />
              <Input
                label="Business Contact Phone"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98450 12345"
                disabled={isSubmitting}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="GSTIN (15 Characters)"
                value={gstin}
                onChange={(e) => handleGstinChange(e.target.value)}
                placeholder="29ABCDE1234F1Z5"
                disabled={isSubmitting}
                helperText="Required if registered under Indian GST"
              />
              <Input
                label="Permanent Account Number (PAN)"
                required
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F"
                disabled={isSubmitting}
                helperText={
                  gstin && pan && gstin.substring(2, 12) === pan
                    ? '✓ Matches embedded GSTIN PAN'
                    : '10-character Indian PAN'
                }
              />
            </div>

            <Input
              label="Registered Warehouse / Store Address"
              required
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="e.g. 42 BVK Iyengar Road, Chickpet"
              disabled={isSubmitting}
            />

            <div className="grid grid-cols-3 gap-2.5">
              <Input
                label="City"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Bengaluru"
                disabled={isSubmitting}
              />
              <Input
                label="State"
                required
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="Karnataka"
                disabled={isSubmitting}
              />
              <Input
                label="PIN Code"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
                placeholder="560053"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Business Category & Eligibility Declaration */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-content-primary">
              <FileCheck className="w-4 h-4 text-emerald-600" />
              <span>Business Eligibility Declaration</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-content-primary mb-1.5">
                Primary Business Category <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  {
                    id: 'electrical_wholesale_distributor',
                    label: 'Electrical Wholesaler / Distributor',
                    sub: 'Supply to dealers, contractors & panels',
                  },
                  {
                    id: 'electrical_retail',
                    label: 'Electrical Retailer / Showroom',
                    sub: 'Retail counter & trade buyers',
                  },
                  {
                    id: 'hardware_electrical',
                    label: 'Hardware & Electrical Store',
                    sub: 'General hardware selling electrical goods',
                  },
                  {
                    id: 'other_unsupported',
                    label: 'Other / Non-Electrical Trade',
                    sub: 'Ineligible for electrical distribution OS',
                  },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setBusinessCategory(cat.id as BusinessCategory)}
                    className={`p-2.5 text-left rounded-xl border transition-all ${
                      businessCategory === cat.id
                        ? 'border-atlas-600 bg-atlas-50 ring-1 ring-atlas-600'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold text-content-primary flex items-center justify-between">
                      <span>{cat.label}</span>
                      {businessCategory === cat.id && (
                        <Check className="w-3.5 h-3.5 text-atlas-600 shrink-0" />
                      )}
                    </div>
                    <span className="text-2xs text-content-secondary block mt-0.5">
                      {cat.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sellsElectricalProducts}
                  onChange={(e) => setSellsElectricalProducts(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-atlas-600 focus:ring-atlas-500"
                  disabled={isSubmitting}
                />
                <div className="text-xs">
                  <span className="font-semibold text-content-primary block">
                    Our business stocks and distributes electrical products
                  </span>
                  <span className="text-2xs text-content-secondary">
                    (Wires, cables, switchgear, switches, sockets, conduits, LED lighting, or motors)
                  </span>
                </div>
              </label>
            </div>

            {/* Product Lines Selection */}
            <div>
              <label className="block text-xs font-semibold text-content-primary mb-1.5">
                Declared Electrical Product Lines <span className="text-rose-500">*</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {SUGGESTED_PRODUCT_LINES.map((line) => {
                  const selected = productLines.includes(line);
                  return (
                    <button
                      key={line}
                      type="button"
                      onClick={() => toggleProductLine(line)}
                      disabled={isSubmitting}
                      className={`text-2xs px-2.5 py-1 rounded-lg border font-medium transition-all ${
                        selected
                          ? 'bg-atlas-600 text-white border-atlas-600'
                          : 'bg-white text-content-secondary border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {selected ? '✓ ' : '+ '}
                      {line}
                    </button>
                  );
                })}
              </div>

              {/* Custom Tag Input */}
              <div className="flex gap-2">
                <Input
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  placeholder="Add custom product line (e.g. Copper Busbars)"
                  disabled={isSubmitting}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomTag();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCustomTag}
                  disabled={!customTagInput.trim() || isSubmitting}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  Add
                </Button>
              </div>

              {/* Declared Tags View */}
              {productLines.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {productLines.map((line) => (
                    <span
                      key={line}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-2xs font-medium"
                    >
                      {line}
                      <button
                        type="button"
                        onClick={() => removeProductLine(line)}
                        disabled={isSubmitting}
                        className="hover:text-emerald-950 focus:outline-none"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-2xs text-content-secondary">
              Authoritative server verification • 7-day trial initialized on approval
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isSubmitting}
                leftIcon={<ShieldCheck className="w-4 h-4" />}
              >
                Submit Verification
              </Button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
};
