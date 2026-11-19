import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CustomersPage } from './CustomersPage';
import { customersService } from '@/services/customers.service';
import { buildPaginatedResult } from '@/lib/pagination';
import { Customer } from '@/types';

const mockOrg = { id: 'org-test', name: 'Atlas Distribution' };
const mockUser = { id: 'user-1' };

vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: () => ({
    currentOrg: mockOrg,
    currentUser: mockUser,
    currentRole: 'admin',
    isMockAuth: false,
    canWriteOperations: true,
  }),
}));

vi.mock('@/hooks/useActionPermission', () => ({
  useActionPermission: () => ({
    check: () => ({ allowed: true }),
    can: () => true,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), toasts: [] }),
}));

vi.mock('@/services/customers.service', () => ({
  customersService: {
    getCustomersPaginated: vi.fn(),
    getCustomerById: vi.fn(),
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
  },
}));

const mockCustomers: Customer[] = [
  {
    id: 'cust-1',
    organizationId: 'org-test',
    name: 'Anil Kumar',
    companyName: 'Anil Enterprises',
    phone: '+91 9876543210',
    email: 'anil@example.com',
    billingAddress: 'Hyderabad, Telangana',
    gstin: '36AAAAA0000A1Z5',
    creditLimit: 50000,
    creditDays: 30,
    isActive: true,
    currentReceivable: 12000,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cust-2',
    organizationId: 'org-test',
    name: 'Bhaskar Rao',
    companyName: 'Bhaskar Electricals',
    phone: '+91 9876543211',
    email: 'bhaskar@example.com',
    billingAddress: 'Vijayawada, AP',
    gstin: '37BBBBB1111B1Z6',
    creditLimit: 100000,
    creditDays: 45,
    isActive: true,
    currentReceivable: 45000,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
  {
    id: 'cust-3',
    organizationId: 'org-test',
    name: 'Chandra Shekar',
    companyName: 'Chandra Hardware',
    phone: '+91 9876543212',
    email: 'chandra@example.com',
    billingAddress: 'Warangal, Telangana',
    gstin: '36CCCCC2222C1Z7',
    creditLimit: 25000,
    creditDays: 15,
    isActive: true,
    currentReceivable: 5000,
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  },
];

describe('CustomersPage — receivable sorting & ergonomics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(customersService.getCustomersPaginated).mockResolvedValue(
      buildPaginatedResult([...mockCustomers], 3, 1, 25)
    );
  });

  it('renders customers and sorts by receivable descending, ascending, and default', async () => {
    render(
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>
    );

    // Initial render displays all three customers
    await waitFor(() => {
      expect(screen.getByText('Anil Enterprises')).toBeInTheDocument();
      expect(screen.getByText('Bhaskar Electricals')).toBeInTheDocument();
      expect(screen.getByText('Chandra Hardware')).toBeInTheDocument();
    });

    const sortButton = screen.getByRole('button', { name: /Sort by Current Receivable/i });
    expect(sortButton).toBeInTheDocument();

    // First click: Sort descending (highest debtors first)
    fireEvent.click(sortButton);

    const rowsDesc = screen.getAllByRole('row');
    // First row is header; row 1 should be Bhaskar (45,000), row 2 Anil (12,000), row 3 Chandra (5,000)
    expect(rowsDesc[1]).toHaveTextContent('Bhaskar Electricals');
    expect(rowsDesc[2]).toHaveTextContent('Anil Enterprises');
    expect(rowsDesc[3]).toHaveTextContent('Chandra Hardware');

    // Second click: Sort ascending (lowest debtors first)
    const sortButtonDesc = screen.getByRole('button', { name: /highest debtors first/i });
    fireEvent.click(sortButtonDesc);

    const rowsAsc = screen.getAllByRole('row');
    // Row 1 should be Chandra (5,000), row 2 Anil (12,000), row 3 Bhaskar (45,000)
    expect(rowsAsc[1]).toHaveTextContent('Chandra Hardware');
    expect(rowsAsc[2]).toHaveTextContent('Anil Enterprises');
    expect(rowsAsc[3]).toHaveTextContent('Bhaskar Electricals');

    // Third click: Reset to default
    const sortButtonAsc = screen.getByRole('button', { name: /lowest debtors first/i });
    fireEvent.click(sortButtonAsc);

    const rowsDefault = screen.getAllByRole('row');
    expect(rowsDefault[1]).toHaveTextContent('Anil Enterprises');
    expect(rowsDefault[2]).toHaveTextContent('Bhaskar Electricals');
    expect(rowsDefault[3]).toHaveTextContent('Chandra Hardware');
  });

  it('renders the primary identifier column with sticky classes for narrow viewports', async () => {
    render(
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Firm & Contact')).toBeInTheDocument();
    });

    const firmHeader = screen.getByText('Firm & Contact').closest('th');
    expect(firmHeader).toHaveClass('sticky');
    expect(firmHeader).toHaveClass('left-0');

    const firstRowCell = screen.getByText('Anil Enterprises').closest('td');
    expect(firstRowCell).toHaveClass('sticky');
    expect(firstRowCell).toHaveClass('left-0');
  });
});
