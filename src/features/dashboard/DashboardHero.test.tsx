import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import { useOrg } from '@/features/organizations/OrgContext';
import { dashboardService } from '@/services/dashboard.service';

vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: vi.fn(),
}));

vi.mock('@/services/dashboard.service', () => ({
  dashboardService: {
    getDashboardMetrics: vi.fn(),
    getSalesTrend: vi.fn().mockResolvedValue([]),
    getReceivablesSummary: vi.fn().mockResolvedValue(null),
    getTopBrandValuation: vi.fn().mockResolvedValue([]),
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Dashboard Operations Center Hero', () => {
  const mockOrg = {
    id: 'org-1',
    name: 'Balaji Electrical Enterprises',
    city: 'Hyderabad',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dashboardService.getDashboardMetrics).mockResolvedValue({
      todaySales: 25000,
      ordersCount: 15,
      totalReceivables: 65000,
      overdueInvoicesCount: 2,
      lowStockItemsCount: 0,
      totalStockValue: 450000,
      recentOrders: [],
      recentPayments: [],
      lowStockProducts: [],
    });
  });

  it('renders dynamic organization name, concise description and operations badge', async () => {
    vi.mocked(useOrg).mockReturnValue({
      currentOrg: mockOrg,
      currentRole: 'owner',
      isMockAuth: true,
      currentUser: { id: 'u1', fullName: 'Tester' },
    } as any);

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Operations Center')).toBeInTheDocument();
    expect(screen.getByText('Demo Workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Balaji Electrical Enterprises' })).toBeInTheDocument();
    expect(screen.getByText(/Real-time operational command for inventory movements, sales orders, and financial workflows\./i)).toBeInTheDocument();
    expect(screen.queryByText(/Electrical Distribution Workspace/i)).not.toBeInTheDocument();
  });

  it('navigates to sales order creation and AI assistant when action buttons are clicked', async () => {
    vi.mocked(useOrg).mockReturnValue({
      currentOrg: mockOrg,
      currentRole: 'owner',
      isMockAuth: true,
      isDemoMode: true,
      isAuthenticated: false,
      canWriteOperations: true,
      currentUser: { id: 'u1', fullName: 'Tester' },
    } as any);

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    const newOrderBtn = await screen.findByRole('button', { name: /New Sales Order/i });
    expect(newOrderBtn).toBeEnabled();
    fireEvent.click(newOrderBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/orders?action=create');

    const aiBtn = screen.getByRole('button', { name: /ATLAS AI/i });
    fireEvent.click(aiBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/ai');
  });

  it('disables New Sales Order button for roles without order creation permission', async () => {
    vi.mocked(useOrg).mockReturnValue({
      currentOrg: mockOrg,
      currentRole: 'viewer',
      isMockAuth: false,
      currentUser: { id: 'u1', fullName: 'Viewer' },
    } as any);

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    const newOrderBtn = await screen.findByRole('button', { name: /New Sales Order/i });
    expect(newOrderBtn).toBeDisabled();
  });
});
