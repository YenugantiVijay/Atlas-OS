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
import { customersService } from '@/services/customers.service';
import { Customer } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/lib/money';

function getInitials(name: string): string {
  if (!name) return 'C';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

export const CustomersPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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

  const loadCustomers = async () => {
    if (!currentOrg) return;
    setIsLoading(true);
    try {
      const data = await customersService.getCustomers(currentOrg.id, isMockAuth);
      setCustomers(data);
    } catch (err: any) {
      showToast('error', 'Failed to load customers', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
    if (searchParams.get('action') === 'create') {
      handleOpenCreate();
      searchParams.delete('action');
      setSearchParams(searchParams);
    }
  }, [currentOrg, searchParams, isMockAuth]);

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

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Customer Name is required.');
      return;
    }
    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      if (editingCustomer) {
        await customersService.updateCustomer(
          currentOrg.id,
          editingCustomer.id,
          {
            name: name.trim(),
            companyName: companyName.trim() || undefined,
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            billingAddress: billingAddress.trim() || undefined,
            gstin: gstin.trim().toUpperCase() || undefined,
            creditLimit: parseFloat(creditLimit) || 0,
            creditDays: parseInt(creditDays, 10) || 30,
          },
          isMockAuth
        );
        showToast('success', 'Customer Updated', `Saved details for ${companyName || name}`);
      } else {
        await customersService.createCustomer(
          currentOrg.id,
          {
            name: name.trim(),
            companyName: companyName.trim() || undefined,
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            billingAddress: billingAddress.trim() || undefined,
            gstin: gstin.trim().toUpperCase() || undefined,
            creditLimit: parseFloat(creditLimit) || 0,
            creditDays: parseInt(creditDays, 10) || 30,
            isActive: true,
          },
          isMockAuth
        );
        showToast('success', 'Customer Created', `Added ${companyName || name} to customer directory.`);
      }

      setIsModalOpen(false);
      await loadCustomers();
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
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Customers & Contractors
            </h1>
            <Badge variant="indigo" size="sm">
              {customers.length} Accounts
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
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
          aria-label="Search customers"
        />
      </Card>

      {/* Customers Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredCustomers.length === 0 ? (
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
                    <div className="flex items-center gap-3">
                      {c.avatarUrl ? (
                        <img
                          src={c.avatarUrl}
                          alt={c.companyName || c.name}
                          className="w-10 h-10 rounded-full object-cover border border-slate-200 shadow-xs shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-atlas-100 text-atlas-800 font-bold text-xs flex items-center justify-center border border-atlas-200 shrink-0">
                          {getInitials(c.name)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-content-primary truncate max-w-xs">
                          {c.companyName || c.name}
                        </div>
                        {c.companyName && (
                          <div className="text-xs text-content-secondary mt-0.5 truncate">
                            Prop: {c.name}
                          </div>
                        )}
                        {c.billingAddress && (
                          <div className="text-xs text-content-muted mt-1 truncate max-w-xs flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                            <span className="truncate">{c.billingAddress}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="text-xs font-mono text-content-primary flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      <span>{c.phone || '—'}</span>
                    </div>
                    {c.email && (
                      <div className="text-xs text-content-secondary flex items-center gap-1.5 mt-1">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>{c.email}</span>
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="font-mono text-xs font-medium text-content-primary">
                      {c.gstin || 'Unregistered'}
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="text-sm font-semibold text-content-primary tabular-nums">
                      {formatCurrency(c.creditLimit)}
                    </div>
                    <div className="text-xs text-content-muted mt-0.5">
                      {c.creditDays} Days Terms
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div
                      className={`text-sm font-bold tabular-nums ${
                        hasBalance ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatCurrency(receivable)}
                    </div>
                    <div className="text-xs text-content-muted mt-0.5">
                      {hasBalance ? 'Outstanding' : 'Settled'}
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
