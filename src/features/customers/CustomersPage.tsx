import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  Edit2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { Customer } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/lib/money';

export const CustomersPage: React.FC = () => {
  const { currentOrg } = useOrg();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('+91 ');
  const [email, setEmail] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [creditLimit, setCreditLimit] = useState('100000');
  const [creditDays, setCreditDays] = useState('30');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadCustomers = () => {
    if (currentOrg) {
      setCustomers(storage.getCustomers(currentOrg.id));
    }
  };

  useEffect(() => {
    loadCustomers();
    if (searchParams.get('action') === 'create') {
      handleOpenCreate();
      searchParams.delete('action');
      setSearchParams(searchParams);
    }
  }, [currentOrg, searchParams]);

  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setName('');
    setCompanyName('');
    setPhone('+91 ');
    setEmail('');
    setBillingAddress('');
    setGstin('');
    setCreditLimit('100000');
    setCreditDays('30');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (c: Customer) => {
    setEditingCustomer(c);
    setName(c.name);
    setCompanyName(c.companyName || '');
    setPhone(c.phone || '+91 ');
    setEmail(c.email || '');
    setBillingAddress(c.billingAddress || '');
    setGstin(c.gstin || '');
    setCreditLimit(String(c.creditLimit));
    setCreditDays(String(c.creditDays));
    setIsModalOpen(true);
  };

  const handleSaveCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Customer Name is required.');
      return;
    }
    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      if (editingCustomer) {
        // Update customer in storage
        const allCusts = storage.getCustomers(currentOrg.id);
        const idx = allCusts.findIndex((c) => c.id === editingCustomer.id);
        if (idx !== -1) {
          allCusts[idx] = {
            ...allCusts[idx],
            name: name.trim(),
            companyName: companyName.trim() || undefined,
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            billingAddress: billingAddress.trim() || undefined,
            gstin: gstin.trim().toUpperCase() || undefined,
            creditLimit: parseFloat(creditLimit) || 0,
            creditDays: parseInt(creditDays, 10) || 30,
            updatedAt: new Date().toISOString(),
          };
          localStorage.setItem('atlas_customers_v1', JSON.stringify(allCusts));
          storage.logAuditEvent(currentOrg.id, 'UPDATE_CUSTOMER', 'CUSTOMER', editingCustomer.id, {
            name,
          });
        }
        showToast('success', 'Customer Updated', `Saved details for ${companyName || name}`);
      } else {
        storage.createCustomer(currentOrg.id, {
          name: name.trim(),
          companyName: companyName.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          billingAddress: billingAddress.trim() || undefined,
          gstin: gstin.trim().toUpperCase() || undefined,
          creditLimit: parseFloat(creditLimit) || 0,
          creditDays: parseInt(creditDays, 10) || 30,
          isActive: true,
        });
        showToast('success', 'Customer Created', `Added ${companyName || name} to customer directory.`);
      }

      setIsModalOpen(false);
      loadCustomers();
    } catch (err: any) {
      showToast('error', 'Operation Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.companyName?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.gstin?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Customers & Contractors
            </h1>
            <Badge variant="violet" size="sm">
              {customers.length} Accounts
            </Badge>
          </div>
          <p className="text-xs text-content-secondary mt-0.5">
            Electrical contractors, builders, and retail dealers with credit terms and live balances.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleOpenCreate}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Add Customer
        </Button>
      </div>

      {/* Search */}
      <Card>
        <Input
          placeholder="Search customers by contractor name, firm name, phone, or GSTIN..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </Card>

      {/* Customers Table */}
      {filteredCustomers.length === 0 ? (
        <EmptyState
          icon={<Users className="w-7 h-7" />}
          title="No customers found"
          description={
            searchQuery
              ? 'No customer records match your search query.'
              : 'Add your first electrical contractor or dealer to start preparing quotations and sales orders.'
          }
          actionLabel="Add Customer"
          onAction={handleOpenCreate}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Firm & Contact</TableHead>
              <TableHead>Contact Info</TableHead>
              <TableHead>GSTIN / Tax</TableHead>
              <TableHead className="text-right">Credit Limit & Days</TableHead>
              <TableHead className="text-right">Current Receivable</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.map((c) => {
              const receivable = c.currentReceivable || 0;
              const hasBalance = receivable > 0;
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-semibold text-content-primary">
                      {c.companyName || c.name}
                    </div>
                    {c.companyName && (
                      <div className="text-xs text-content-secondary mt-0.5">
                        Prop: {c.name}
                      </div>
                    )}
                    {c.billingAddress && (
                      <div className="text-[11px] text-content-muted mt-1 truncate max-w-xs flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{c.billingAddress}</span>
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="text-xs font-mono text-content-primary flex items-center gap-1">
                      <Phone className="w-3 h-3 text-content-muted" />
                      <span>{c.phone || '—'}</span>
                    </div>
                    {c.email && (
                      <div className="text-[11px] text-content-secondary flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3 text-content-muted" />
                        <span>{c.email}</span>
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="font-mono text-xs text-content-primary">
                      {c.gstin || 'Unregistered'}
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="text-xs font-semibold text-content-primary">
                      {formatCurrency(c.creditLimit)}
                    </div>
                    <div className="text-[10px] text-content-muted">
                      {c.creditDays} Days Terms
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div
                      className={`text-xs font-bold ${
                        hasBalance ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatCurrency(receivable)}
                    </div>
                    <div className="text-[10px] text-content-muted">
                      {hasBalance ? 'Outstanding' : 'Cleared'}
                    </div>
                  </TableCell>

                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(c)}
                      leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Add / Edit Customer Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingCustomer ? 'Edit Customer Record' : 'Add New Customer Account'}
        description="Register commercial electrical contractors, retail partners, or institutions."
        maxWidth="lg"
      >
        <form onSubmit={handleSaveCustomer} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Firm / Trade Name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Bangalore Electro Enterprises"
            />
            <Input
              label="Contact Person Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ramesh Kumar"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Phone Number"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
            />
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="billing@customer.com"
            />
          </div>

          <Input
            label="GSTIN (15 Digits)"
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
            placeholder="29AAAAA0000A1Z5"
          />

          <Input
            label="Billing & Delivery Address"
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            placeholder="Site 48, Peenya Industrial Area 2nd Stage, Bengaluru"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Credit Limit (₹)"
              type="number"
              step="1000"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
            <Input
              label="Credit Period (Days)"
              type="number"
              value={creditDays}
              onChange={(e) => setCreditDays(e.target.value)}
            />
          </div>

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
              {editingCustomer ? 'Update Customer' : 'Save Customer'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
