import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ImageUpload } from '@/components/ui/ImageUpload';
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
  const [phone, setPhone] = useState('+91 ');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [pincode, setPincode] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('error', 'Organization Name Required', 'Please enter a valid organization name.');
      return;
    }

    setIsSubmitting(true);
    try {
      createOrganization({
        name: name.trim(),
        legalName: legalName.trim() || undefined,
        gstin: gstin.trim().toUpperCase() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        pincode: pincode.trim() || undefined,
        currency: 'INR',
        logoUrl: logoUrl || undefined,
      });

      showToast('success', 'Organization Created', `Switched to newly created organization: ${name}`);
      onClose();
      // Reset
      setName('');
      setLegalName('');
      setGstin('');
      setLogoUrl('');
    } catch (err: any) {
      showToast('error', 'Failed to create organization', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Business Organization"
      description="Set up an independent distributor workspace with dedicated inventory, orders, and ledger."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <ImageUpload
          label="Shop / Business Logo"
          value={logoUrl}
          onChange={setLogoUrl}
          shape="square"
          helperText="Upload store logo or branding (Optional)"
        />

        <Input
          label="Distributor Business Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Balaji Electrical & Hardware Agencies"
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Legal Entity Name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="e.g. Balaji Electricals Pvt Ltd"
          />
          <Input
            label="GSTIN (15 characters)"
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
            placeholder="29ABCDE1234F1Z5"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="billing@distributor.in"
          />
        </div>

        <Input
          label="Shop / Warehouse Address"
          value={addressLine1}
          onChange={(e) => setAddressLine1(e.target.value)}
          placeholder="Shop 14, Electrical Market Road"
        />

        <div className="grid grid-cols-3 gap-3">
          <Input
            label="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Bengaluru"
          />
          <Input
            label="State"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="Karnataka"
          />
          <Input
            label="Pincode"
            value={pincode}
            onChange={(e) => setPincode(e.target.value)}
            placeholder="560002"
          />
        </div>

        <div className="flex justify-end gap-2.5 pt-4 border-t border-border mt-5">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Create Organization
          </Button>
        </div>
      </form>
    </Modal>
  );
};
