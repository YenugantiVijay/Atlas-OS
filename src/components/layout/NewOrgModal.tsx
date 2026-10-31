import React, { useState, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useOrg } from '@/features/organizations/OrgContext';
import { useToast } from '@/components/ui/Toast';

export interface NewOrgModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewOrgModal: React.FC<NewOrgModalProps> = ({ isOpen, onClose }) => {
  const { createOrganization } = useOrg();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [phone, setPhone] = useState('+91 ');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [pincode, setPincode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyConflict, setIdempotencyConflict] = useState(false);

  // Maintain one idempotency key per logical creation attempt across network retries
  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'atlas-client-' + Date.now()
  );

  const resetForm = () => {
    setName('');
    setLegalName('');
    setGstin('');
    setPan('');
    setPhone('+91 ');
    setEmail('');
    setCity('');
    setState('');
    setAddressLine1('');
    setPincode('');
    setIdempotencyConflict(false);
    // Generate fresh idempotency key for the next attempt
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || idempotencyConflict) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast('error', 'Organization Name Required', 'Please enter a valid organization name.');
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

    setIsSubmitting(true);
    try {
      await createOrganization({
        name: trimmedName,
        legalName: legalName.trim() || undefined,
        gstin: trimmedGstin || undefined,
        pan: effectivePan || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        pincode: pincode.trim() || undefined,
        currency: 'INR',
        idempotencyKey: idempotencyKeyRef.current,
      });

      showToast('success', 'Organization Created', `Switched to newly created organization: ${trimmedName}`);
      handleClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ERR_IDEMPOTENCY_CONFLICT')) {
        setIdempotencyConflict(true);
      } else {
        showToast('error', 'Failed to create organization', msg);
      }
      // NOTE: idempotencyKeyRef.current is preserved intentionally across retries
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create Business Organization"
      description="Set up an independent distributor workspace with dedicated inventory, orders, and ledger."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Distributor Business Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Balaji Electrical & Hardware Agencies"
          disabled={isSubmitting}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input
            label="Legal Entity Name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="e.g. Balaji Electricals Pvt Ltd"
            disabled={isSubmitting}
          />
          <Input
            label="GSTIN (15 characters)"
            value={gstin}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              setGstin(val);
              if (val.length >= 12 && !pan) {
                const derived = val.substring(2, 12);
                if (/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(derived)) {
                  setPan(derived);
                }
              }
            }}
            placeholder="29ABCDE1234F1Z5"
            disabled={isSubmitting}
          />
          <Input
            label="PAN (10 characters)"
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase())}
            placeholder="ABCDE1234F"
            disabled={isSubmitting}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            disabled={isSubmitting}
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="billing@distributor.in"
            disabled={isSubmitting}
          />
        </div>

        <Input
          label="Shop / Warehouse Address"
          value={addressLine1}
          onChange={(e) => setAddressLine1(e.target.value)}
          placeholder="Shop 14, Electrical Market Road"
          disabled={isSubmitting}
        />

        <div className="grid grid-cols-3 gap-3">
          <Input
            label="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Enter city"
            disabled={isSubmitting}
          />
          <Input
            label="State"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="Enter state"
            disabled={isSubmitting}
          />
          <Input
            label="Pincode"
            value={pincode}
            onChange={(e) => setPincode(e.target.value)}
            placeholder="Enter pincode"
            disabled={isSubmitting}
          />
        </div>

        {idempotencyConflict && (
          <div
            data-testid="idempotency-conflict-alert"
            className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm space-y-2 text-slate-800 dark:text-slate-200"
          >
            <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400 font-medium">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>Identity Conflict with Previous Attempt</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Core organization details (Name, Legal Name, GSTIN, or PAN) were modified after a previous submission.
              Because the previous attempt may have already created an organization on the server, modifying core details requires an explicit confirmation to start a fresh creation attempt with a new tracking key.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => {
                  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                    idempotencyKeyRef.current = crypto.randomUUID();
                  }
                  setIdempotencyConflict(false);
                  showToast(
                    'info',
                    'New Attempt Initialized',
                    'Assigned a fresh idempotency key. You may now submit your organization.'
                  );
                }}
              >
                Confirm New Attempt
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIdempotencyConflict(false)}
              >
                Keep Reviewing
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-4 border-t border-border mt-5">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={isSubmitting}
            disabled={isSubmitting || idempotencyConflict}
          >
            Create Organization
          </Button>
        </div>
      </form>
    </Modal>
  );
};
