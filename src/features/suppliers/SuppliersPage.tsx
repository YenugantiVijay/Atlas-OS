import React, { useState, useEffect } from 'react';
import {
  Truck,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { suppliersService } from '@/services/suppliers.service';
import { Supplier } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

export const SuppliersPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const { showToast } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('+91 ');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('30 Days Net');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadSuppliers = async () => {
    if (!currentOrg) return;
    setIsLoading(true);
    try {
      const data = await suppliersService.getSuppliers(currentOrg.id, isMockAuth);
      setSuppliers(data);
    } catch (err: any) {
      showToast('error', 'Failed to load suppliers', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, [currentOrg, isMockAuth]);

  const handleOpenCreate = () => {
    setName('');
    setCompanyName('');
    setContactPerson('');
    setPhone('+91 ');
    setEmail('');
    setAddress('');
    setGstin('');
    setPaymentTerms('30 Days Net');
    setIsModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Supplier Name is required.');
      return;
    }
    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      await suppliersService.createSupplier(
        currentOrg.id,
        {
          name: name.trim(),
          companyName: companyName.trim() || undefined,
          contactPerson: contactPerson.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          gstin: gstin.trim().toUpperCase() || undefined,
          paymentTerms: paymentTerms.trim() || undefined,
          isActive: true,
        },
        isMockAuth
      );

      showToast('success', 'Supplier Registered', `Added ${name} to authorized vendors.`);
      setIsModalOpen(false);
      await loadSuppliers();
    } catch (err: any) {
      showToast('error', 'Operation Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredSuppliers = suppliers.filter((s) => {
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.companyName?.toLowerCase().includes(q) ||
      s.contactPerson?.toLowerCase().includes(q) ||
      s.gstin?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Suppliers & Vendors
            </h1>
            <Badge variant="indigo" size="sm">
              {suppliers.length} Vendors
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Authorized wire, switchgear, and lighting manufacturers & super stockists.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleOpenCreate}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Add Supplier
        </Button>
      </div>

      {/* Search */}
      <Card>
        <Input
          placeholder="Search suppliers by name, parent company, or GSTIN..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
          aria-label="Search suppliers"
        />
      </Card>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredSuppliers.length === 0 ? (
        <EmptyState
          icon={<Truck className="w-7 h-7" />}
          title="No suppliers found"
          description="Register your manufacturers and wholesale distributors."
          actionLabel="Add Supplier"
          onAction={handleOpenCreate}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier & Depo</TableHead>
              <TableHead>Contact Person</TableHead>
              <TableHead>Contact Details</TableHead>
              <TableHead>GSTIN / Tax</TableHead>
              <TableHead>Payment Terms</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSuppliers.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <div className="font-semibold text-sm text-content-primary">{s.name}</div>
                  {s.companyName && (
                    <div className="text-xs text-content-secondary mt-0.5">{s.companyName}</div>
                  )}
                  {s.address && (
                    <div className="text-xs text-content-muted mt-1 truncate max-w-xs flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{s.address}</span>
                    </div>
                  )}
                </TableCell>

                <TableCell className="text-sm font-medium text-content-primary">
                  {s.contactPerson || '—'}
                </TableCell>

                <TableCell>
                  <div className="text-xs font-mono text-content-primary flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{s.phone || '—'}</span>
                  </div>
                  {s.email && (
                    <div className="text-xs text-content-secondary flex items-center gap-1.5 mt-1">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      <span>{s.email}</span>
                    </div>
                  )}
                </TableCell>

                <TableCell className="font-mono text-xs font-medium text-content-primary">
                  {s.gstin || '—'}
                </TableCell>

                <TableCell className="text-xs text-content-secondary">
                  <Badge variant="default" size="sm">
                    {s.paymentTerms || 'Standard Terms'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add Supplier Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add Authorized Supplier"
        description="Register a manufacturing brand or primary wholesale stockist."
        maxWidth="lg"
      >
        <form onSubmit={handleSaveSupplier} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Supplier Name / Depot"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Polycab Regional Depot"
            />
            <Input
              label="Parent Corporate Entity"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Polycab Wires & Cables Ltd"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Contact Person"
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              placeholder="e.g. Ashok Hegde"
            />
            <Input
              label="Phone Number"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 80 2234 5678"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="depot.blr@polycab.com"
            />
            <Input
              label="GSTIN"
              value={gstin}
              onChange={(e) => setGstin(e.target.value)}
              placeholder="29AADCP1234D1Z9"
            />
          </div>

          <Input
            label="Warehouse / Factory Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Warehouse Complex, Tumkur Road, Bengaluru"
          />

          <Input
            label="Payment & Credit Terms"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            placeholder="e.g. 30 Days Net, 2% Cash Discount for 7 Days"
          />

          <div className="flex justify-end gap-2.5 pt-4 border-t border-border mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Save Supplier
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
