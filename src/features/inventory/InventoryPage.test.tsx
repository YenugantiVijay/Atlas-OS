import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InventoryPage } from './InventoryPage';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { inventoryService } from '@/services/inventory.service';
import { productsService } from '@/services/products.service';
import { Organization, Product, StockMovement } from '@/types';

// Mock Toast
const mockShowToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Services
vi.mock('@/services/inventory.service', () => ({
  inventoryService: {
    getStockMovements: vi.fn(),
    adjustStock: vi.fn(),
  },
}));

vi.mock('@/services/products.service', () => ({
  productsService: {
    getProducts: vi.fn(),
  },
}));

describe('InventoryPage — Component-Level Idempotency and Submission Integrity', () => {
  const mockOrg: Organization = {
    id: 'org-test-inv-001',
    name: 'Polycab Distributors Bangalore',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleProducts: Product[] = [
    {
      id: 'prod-uuid-001',
      organizationId: 'org-test-inv-001',
      name: 'Polycab 2.5 sqmm FR PVC Copper Wire',
      sku: 'CBL-CU-25',
      hsnCode: '8544',
      category: 'Wires & Cables',
      uom: 'Meters',
      purchaseCost: 1500,
      sellingPrice: 1850,
      taxRate: 18,
      reorderThreshold: 5,
      currentStock: 25,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleMovements: StockMovement[] = [
    {
      id: 'mov-init-001',
      organizationId: 'org-test-inv-001',
      productId: 'prod-uuid-001',
      quantityChange: 25,
      movementType: 'OPENING_STOCK',
      referenceType: 'OPENING_STOCK',
      notes: 'Initial warehouse inventory',
      createdAt: '2026-01-01T10:00:00Z',
      product: sampleProducts[0],
    },
  ];

  const setupOrgContext = (overrides: Partial<OrgContextModule.OrgContextType> = {}) => {
    const defaultCtx: OrgContextModule.OrgContextType = {
      currentOrg: mockOrg,
      organizations: [mockOrg],
      currentRole: 'inventory',
      currentUser: { id: 'usr-1', email: 'inventory@polycab.com', fullName: 'Inventory Manager' },
      session: null,
      isAuthenticated: true,
      isMockAuth: false,
      isDemoMode: false,
      isLoadingAuth: false,
      isLoadingOrgData: false,
      isSwitchingOrg: false,
      authError: null,
      eligibility: {
        organizationId: mockOrg.id,
        status: 'approved',
        businessCategory: 'electrical_wholesale_distributor',
        sellsElectricalProducts: true,
        productLines: ['Wires & Cables'],
        declaredAt: '2026-01-01T00:00:00Z',
        declaredBy: 'usr-1',
        reviewedAt: null,
        rejectionReason: null,
      },
      subscription: {
        organizationId: mockOrg.id,
        planTier: 'growth',
        status: 'active',
        trialStartedAt: '2026-01-01T00:00:00Z',
        trialEndsAt: '2026-01-08T00:00:00Z',
        currentPeriodStartsAt: '2026-01-01T00:00:00Z',
        currentPeriodEndsAt: '2027-01-01T00:00:00Z',
        paymentMethodEntered: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      canWriteOperations: true,
      switchOrganization: vi.fn(),
      createOrganization: vi.fn(),
      updateOrganization: vi.fn(),
      updateCurrentUser: vi.fn(),
      refreshOrgData: vi.fn(),
      memberships: [],
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      enterDemoMode: vi.fn(),
      exitDemoMode: vi.fn(),
      ...overrides,
    };

    vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue(defaultCtx);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupOrgContext();
    vi.mocked(productsService.getProducts).mockResolvedValue(sampleProducts);
    vi.mocked(inventoryService.getStockMovements).mockResolvedValue(sampleMovements);
  });

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // --------------------------------------------------------------------------
  // TEST 1: Initial submission with valid generated UUID
  // --------------------------------------------------------------------------
  it('submits manual adjustment with a valid, generated UUID idempotency key', async () => {
    vi.mocked(inventoryService.adjustStock).mockResolvedValue({
      id: 'mov-adj-101',
      organizationId: mockOrg.id,
      productId: sampleProducts[0].id,
      quantityChange: -4,
      movementType: 'ADJUSTMENT',
      referenceType: 'MANUAL_ADJUSTMENT',
      notes: 'Damaged coils scraped',
      createdAt: new Date().toISOString(),
    });

    render(<InventoryPage />);

    // Wait for initial data load
    await waitFor(() => {
      expect(screen.getByText('Inventory Movement Ledger')).toBeInTheDocument();
    });

    // Open adjustment modal
    fireEvent.click(screen.getByRole('button', { name: /adjust stock/i }));
    expect(screen.getByText('Manual Stock Adjustment')).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByPlaceholderText('e.g. +10 or -3'), {
      target: { value: '-4' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Physical cycle count discrepancy/i), {
      target: { value: 'Damaged coils scraped' },
    });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: /record adjustment/i }));

    await waitFor(() => {
      expect(inventoryService.adjustStock).toHaveBeenCalledTimes(1);
    });

    const [calledOrgId, calledProdId, calledQty, calledNotes, calledKey, calledMock] =
      vi.mocked(inventoryService.adjustStock).mock.calls[0];

    expect(calledOrgId).toBe(mockOrg.id);
    expect(calledProdId).toBe(sampleProducts[0].id);
    expect(calledQty).toBe(-4);
    expect(calledNotes).toBe('Damaged coils scraped');
    expect(calledKey).toMatch(UUID_REGEX);
    expect(calledMock).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Duplicate-click prevention while isSubmitting is true
  // --------------------------------------------------------------------------
  it('prevents duplicate submissions when the user clicks submit multiple times while pending', async () => {
    let resolveAdjustment!: (value: any) => void;
    const pendingPromise = new Promise((resolve) => {
      resolveAdjustment = resolve;
    });
    vi.mocked(inventoryService.adjustStock).mockReturnValue(pendingPromise as any);

    render(<InventoryPage />);

    await waitFor(() => {
      expect(screen.getByText('Inventory Movement Ledger')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /adjust stock/i }));

    fireEvent.change(screen.getByPlaceholderText('e.g. +10 or -3'), {
      target: { value: '-2' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Physical cycle count discrepancy/i), {
      target: { value: 'Audit count' },
    });

    const submitBtn = screen.getByRole('button', { name: /record adjustment/i });

    // First click triggers submission
    fireEvent.click(submitBtn);

    // Rapid second click while still in-flight
    fireEvent.click(submitBtn);

    expect(inventoryService.adjustStock).toHaveBeenCalledTimes(1);

    // Resolve in-flight request
    resolveAdjustment({
      id: 'mov-adj-102',
      organizationId: mockOrg.id,
      productId: sampleProducts[0].id,
      quantityChange: -2,
      movementType: 'ADJUSTMENT',
      createdAt: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('success', 'Adjustment Recorded', expect.any(String));
    });
  });

  // --------------------------------------------------------------------------
  // TEST 3: Timeout/error retry reusing the exact same key
  // --------------------------------------------------------------------------
  it('reuses the exact same idempotency key when retrying after a timeout or network failure', async () => {
    // 1st attempt fails with timeout error
    vi.mocked(inventoryService.adjustStock).mockRejectedValueOnce(
      new Error('Gateway timeout (504): upstream database timeout')
    );
    // 2nd attempt succeeds
    vi.mocked(inventoryService.adjustStock).mockResolvedValueOnce({
      id: 'mov-adj-103',
      organizationId: mockOrg.id,
      productId: sampleProducts[0].id,
      quantityChange: -3,
      movementType: 'ADJUSTMENT',
      createdAt: new Date().toISOString(),
    });

    render(<InventoryPage />);

    await waitFor(() => {
      expect(screen.getByText('Inventory Movement Ledger')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /adjust stock/i }));

    fireEvent.change(screen.getByPlaceholderText('e.g. +10 or -3'), {
      target: { value: '-3' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Physical cycle count discrepancy/i), {
      target: { value: 'Warehouse cycle count variance' },
    });

    const submitBtn = screen.getByRole('button', { name: /record adjustment/i });

    // 1st submission
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(inventoryService.adjustStock).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        'error',
        'Adjustment Failed',
        'Gateway timeout (504): upstream database timeout'
      );
    });

    // The modal must remain open
    expect(screen.getByText('Manual Stock Adjustment')).toBeInTheDocument();

    const firstAttemptKey = vi.mocked(inventoryService.adjustStock).mock.calls[0][4];
    expect(firstAttemptKey).toMatch(UUID_REGEX);

    // 2nd submission (retry)
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(inventoryService.adjustStock).toHaveBeenCalledTimes(2);
    });

    const secondAttemptKey = vi.mocked(inventoryService.adjustStock).mock.calls[1][4];

    // CRITICAL: The retry must preserve the exact same UUID key!
    expect(secondAttemptKey).toBe(firstAttemptKey);
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Adjustment Recorded', expect.any(String));
  });

  // --------------------------------------------------------------------------
  // TEST 4: Successful completion resets key and closes modal
  // --------------------------------------------------------------------------
  it('resets the idempotency key and closes modal on success so next adjustment gets a fresh key', async () => {
    vi.mocked(inventoryService.adjustStock).mockResolvedValue({
      id: 'mov-adj-104',
      organizationId: mockOrg.id,
      productId: sampleProducts[0].id,
      quantityChange: 10,
      movementType: 'ADJUSTMENT',
      createdAt: new Date().toISOString(),
    });

    render(<InventoryPage />);

    await waitFor(() => {
      expect(screen.getByText('Inventory Movement Ledger')).toBeInTheDocument();
    });

    // --- First Adjustment ---
    fireEvent.click(screen.getByRole('button', { name: /adjust stock/i }));

    fireEvent.change(screen.getByPlaceholderText('e.g. +10 or -3'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Physical cycle count discrepancy/i), {
      target: { value: 'Found surplus coils' },
    });

    fireEvent.click(screen.getByRole('button', { name: /record adjustment/i }));

    await waitFor(() => {
      expect(inventoryService.adjustStock).toHaveBeenCalledTimes(1);
    });

    const firstKey = vi.mocked(inventoryService.adjustStock).mock.calls[0][4];

    // Wait for modal to close
    await waitFor(() => {
      expect(screen.queryByText('Manual Stock Adjustment')).not.toBeInTheDocument();
    });

    // --- Second Adjustment (separate logical submission) ---
    fireEvent.click(screen.getByRole('button', { name: /adjust stock/i }));
    expect(screen.getByText('Manual Stock Adjustment')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g. +10 or -3'), {
      target: { value: '-2' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Physical cycle count discrepancy/i), {
      target: { value: 'Damaged item' },
    });

    fireEvent.click(screen.getByRole('button', { name: /record adjustment/i }));

    await waitFor(() => {
      expect(inventoryService.adjustStock).toHaveBeenCalledTimes(2);
    });

    const secondKey = vi.mocked(inventoryService.adjustStock).mock.calls[1][4];

    // Fresh logical adjustment must generate a distinct key
    expect(secondKey).toMatch(UUID_REGEX);
    expect(secondKey).not.toBe(firstKey);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Changed-payload behavior retains session key on input change
  // --------------------------------------------------------------------------
  it('retains the submission idempotency key when user edits payload after failure', async () => {
    // 1st attempt fails (e.g. quantity was too large)
    vi.mocked(inventoryService.adjustStock).mockRejectedValueOnce(
      new Error('Insufficient stock: Available: 5, Requested: -20')
    );
    // 2nd attempt succeeds with corrected payload
    vi.mocked(inventoryService.adjustStock).mockResolvedValueOnce({
      id: 'mov-adj-105',
      organizationId: mockOrg.id,
      productId: sampleProducts[0].id,
      quantityChange: -3,
      movementType: 'ADJUSTMENT',
      createdAt: new Date().toISOString(),
    });

    render(<InventoryPage />);

    await waitFor(() => {
      expect(screen.getByText('Inventory Movement Ledger')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /adjust stock/i }));

    const qtyInput = screen.getByPlaceholderText('e.g. +10 or -3');
    const reasonInput = screen.getByPlaceholderText(/Physical cycle count discrepancy/i);
    const submitBtn = screen.getByRole('button', { name: /record adjustment/i });

    // Initial erroneous input
    fireEvent.change(qtyInput, { target: { value: '-20' } });
    fireEvent.change(reasonInput, { target: { value: 'Initial cycle correction' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(inventoryService.adjustStock).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(
        'error',
        'Adjustment Failed',
        'Insufficient stock: Available: 5, Requested: -20'
      );
    });

    const firstKey = vi.mocked(inventoryService.adjustStock).mock.calls[0][4];

    // User corrects the quantity while modal remains open
    fireEvent.change(qtyInput, { target: { value: '-3' } });

    // Submit corrected adjustment
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(inventoryService.adjustStock).toHaveBeenCalledTimes(2);
    });

    const [calledOrgId, calledProdId, calledQty, calledNotes, calledKey] =
      vi.mocked(inventoryService.adjustStock).mock.calls[1];

    expect(calledOrgId).toBe(mockOrg.id);
    expect(calledProdId).toBe(sampleProducts[0].id);
    expect(calledQty).toBe(-3);
    expect(calledNotes).toBe('Initial cycle correction');
    // Retains the modal session key
    expect(calledKey).toBe(firstKey);
  });
});
