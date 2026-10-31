import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewOrgModal } from './NewOrgModal';

// Mocks
const mockCreateOrg = vi.fn();
const mockShowToast = vi.fn();

vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: () => ({
    createOrganization: mockCreateOrg,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

describe('Phase 2.2 / 2.5: NewOrgModal Form, Idempotency & Error Handling Integration', () => {
  const defaultOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('8. Modal remains open when creation fails, form values preserved, and error toast displayed', async () => {
    mockCreateOrg.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "organizations_gstin_key"')
    );

    render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    // Fill form fields
    const nameInput = screen.getByLabelText(/Distributor Business Name/i);
    const legalNameInput = screen.getByLabelText(/Legal Entity Name/i);
    const gstinInput = screen.getByLabelText(/GSTIN/i);
    const panInput = screen.getByLabelText(/PAN/i);
    const phoneInput = screen.getByLabelText(/Phone/i);
    const emailInput = screen.getByLabelText(/Email/i);
    const addressInput = screen.getByLabelText(/Shop \/ Warehouse Address/i);
    const cityInput = screen.getByLabelText(/City/i);
    const stateInput = screen.getByLabelText(/State/i);
    const pincodeInput = screen.getByLabelText(/Pincode/i);

    fireEvent.change(nameInput, { target: { value: 'Shree Balaji Electricals' } });
    fireEvent.change(legalNameInput, { target: { value: 'Balaji Electricals Pvt Ltd' } });
    fireEvent.change(gstinInput, { target: { value: '29ABCDE1234F1Z5' } });
    fireEvent.change(panInput, { target: { value: 'ABCDE1234F' } });
    fireEvent.change(phoneInput, { target: { value: '+91 98765 43210' } });
    fireEvent.change(emailInput, { target: { value: 'info@balaji.in' } });
    fireEvent.change(addressInput, { target: { value: 'Shop 12, Main Bazaar' } });
    fireEvent.change(cityInput, { target: { value: 'Bengaluru' } });
    fireEvent.change(stateInput, { target: { value: 'Karnataka' } });
    fireEvent.change(pincodeInput, { target: { value: '560002' } });

    const submitBtn = screen.getByRole('button', { name: /Create Organization/i });
    fireEvent.click(submitBtn);

    // Assert createOrganization was called
    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(1);
    });

    // Assert error toast was shown
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'error',
        'Failed to create organization',
        'duplicate key value violates unique constraint "organizations_gstin_key"'
      );
    });

    // Assert modal was NOT closed
    expect(defaultOnClose).not.toHaveBeenCalled();

    // Assert all form inputs are preserved so user can rectify errors
    expect((nameInput as HTMLInputElement).value).toBe('Shree Balaji Electricals');
    expect((legalNameInput as HTMLInputElement).value).toBe('Balaji Electricals Pvt Ltd');
    expect((gstinInput as HTMLInputElement).value).toBe('29ABCDE1234F1Z5');
    expect((panInput as HTMLInputElement).value).toBe('ABCDE1234F');
    expect((phoneInput as HTMLInputElement).value).toBe('+91 98765 43210');
    expect((emailInput as HTMLInputElement).value).toBe('info@balaji.in');
    expect((addressInput as HTMLInputElement).value).toBe('Shop 12, Main Bazaar');
    expect((cityInput as HTMLInputElement).value).toBe('Bengaluru');
    expect((stateInput as HTMLInputElement).value).toBe('Karnataka');
    expect((pincodeInput as HTMLInputElement).value).toBe('560002');

    // Assert inputs are re-enabled after failure
    expect(nameInput).not.toBeDisabled();
    expect(submitBtn).not.toBeDisabled();
  });

  it('9. Modal closes after successful creation, toast displayed, and form fields reset', async () => {
    mockCreateOrg.mockResolvedValueOnce({
      id: 'org-created-uuid-1',
      name: 'Venkata Electrical Store',
      legalName: 'Venkata Store LLP',
      gstin: '37ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      currency: 'INR',
      createdAt: '2026-10-30T10:00:00Z',
      updatedAt: '2026-10-30T10:00:00Z',
    });

    const { rerender } = render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    const nameInput = screen.getByLabelText(/Distributor Business Name/i);
    const gstinInput = screen.getByLabelText(/GSTIN/i);

    fireEvent.change(nameInput, { target: { value: 'Venkata Electrical Store' } });
    fireEvent.change(gstinInput, { target: { value: '37ABCDE1234F1Z5' } });

    const submitBtn = screen.getByRole('button', { name: /Create Organization/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'success',
        'Organization Created',
        expect.stringContaining('Venkata Electrical Store')
      );
    });

    expect(defaultOnClose).toHaveBeenCalledTimes(1);

    // Simulate reopen to verify form was reset
    rerender(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);
    const reopenedNameInput = screen.getByLabelText(/Distributor Business Name/i);
    expect((reopenedNameInput as HTMLInputElement).value).toBe('');
  });

  it('10. Duplicate submission prevention: submit button loading, inputs disabled, double-clicks ignored', async () => {
    let resolvePromise: (val: unknown) => void = () => {};
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    mockCreateOrg.mockReturnValueOnce(pendingPromise);

    render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    const nameInput = screen.getByLabelText(/Distributor Business Name/i);
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    const submitBtn = screen.getByRole('button', { name: /Create Organization/i });

    fireEvent.change(nameInput, { target: { value: 'Concurrent Test Org' } });

    // First click
    fireEvent.click(submitBtn);

    // In flight: inputs and buttons should be disabled
    expect(nameInput).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    expect(submitBtn).toBeDisabled();

    // Second click while in flight should be blocked by if (isSubmitting) return
    fireEvent.click(submitBtn);

    // createOrganization must only be invoked ONCE
    expect(mockCreateOrg).toHaveBeenCalledTimes(1);

    // Resolve the creation request
    resolvePromise({
      id: 'org-concurrent-uuid',
      name: 'Concurrent Test Org',
      currency: 'INR',
      createdAt: '2026-10-30T10:00:00Z',
      updatedAt: '2026-10-30T10:00:00Z',
    });

    await waitFor(() => {
      expect(defaultOnClose).toHaveBeenCalledTimes(1);
    });
  });

  it('11. Idempotency Key Preservation Across Retry: reuses the same attempt key when retrying after error', async () => {
    mockCreateOrg.mockRejectedValueOnce(new Error('Connection timeout'));
    mockCreateOrg.mockResolvedValueOnce({
      id: 'org-retry-uuid',
      name: 'Retry Success Org',
      currency: 'INR',
      createdAt: '2026-10-30T10:00:00Z',
      updatedAt: '2026-10-30T10:00:00Z',
    });

    render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    const nameInput = screen.getByLabelText(/Distributor Business Name/i);
    fireEvent.change(nameInput, { target: { value: 'Retry Success Org' } });

    const submitBtn = screen.getByRole('button', { name: /Create Organization/i });

    // First attempt fails
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(1);
    });

    const firstKey = mockCreateOrg.mock.calls[0][0].idempotencyKey;
    expect(firstKey).toBeDefined();

    // Second attempt (retry of same attempt)
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(2);
    });

    const secondKey = mockCreateOrg.mock.calls[1][0].idempotencyKey;
    // Must be the identical key to allow backend idempotent replay
    expect(secondKey).toBe(firstKey);
  });

  it('12. Idempotency Key Regeneration: generates a new key on a new creation attempt after success', async () => {
    mockCreateOrg.mockResolvedValueOnce({
      id: 'org-1-uuid',
      name: 'Org One',
      currency: 'INR',
      createdAt: '2026-10-30T10:00:00Z',
      updatedAt: '2026-10-30T10:00:00Z',
    });

    const { rerender } = render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    const nameInput = screen.getByLabelText(/Distributor Business Name/i);
    fireEvent.change(nameInput, { target: { value: 'Org One' } });

    const submitBtn = screen.getByRole('button', { name: /Create Organization/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(1);
    });

    const firstAttemptKey = mockCreateOrg.mock.calls[0][0].idempotencyKey;

    // Simulate reopening modal for a new attempt
    mockCreateOrg.mockResolvedValueOnce({
      id: 'org-2-uuid',
      name: 'Org Two',
      currency: 'INR',
      createdAt: '2026-10-30T10:00:00Z',
      updatedAt: '2026-10-30T10:00:00Z',
    });

    rerender(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);
    const reopenedNameInput = screen.getByLabelText(/Distributor Business Name/i);
    fireEvent.change(reopenedNameInput, { target: { value: 'Org Two' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Organization/i }));

    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(2);
    });

    const secondAttemptKey = mockCreateOrg.mock.calls[1][0].idempotencyKey;
    // Must be a different key for a brand new attempt
    expect(secondAttemptKey).not.toBe(firstAttemptKey);
  });

  it('13. Auxiliary field edits retain the same idempotency key across retries', async () => {
    mockCreateOrg.mockRejectedValueOnce(new Error('Temporary network glitch'));
    mockCreateOrg.mockResolvedValueOnce({
      id: 'org-aux-edit-uuid',
      name: 'Dynamic Supplies Ltd',
      currency: 'INR',
      createdAt: '2026-10-30T10:00:00Z',
      updatedAt: '2026-10-30T10:00:00Z',
    });

    render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    const nameInput = screen.getByLabelText(/Distributor Business Name/i);
    const phoneInput = screen.getByLabelText(/Phone/i);
    const cityInput = screen.getByLabelText(/City/i);
    const submitBtn = screen.getByRole('button', { name: /Create Organization/i });

    fireEvent.change(nameInput, { target: { value: 'Dynamic Supplies Ltd' } });
    fireEvent.change(phoneInput, { target: { value: '+91 99999 11111' } });

    // First attempt fails
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(1);
    });

    const initialKey = mockCreateOrg.mock.calls[0][0].idempotencyKey;
    expect(initialKey).toBeDefined();

    // User updates auxiliary fields (phone and city) without touching core fields
    fireEvent.change(phoneInput, { target: { value: '+91 99999 22222' } });
    fireEvent.change(cityInput, { target: { value: 'Hyderabad' } });

    // Retry submission
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(2);
    });

    const secondKey = mockCreateOrg.mock.calls[1][0].idempotencyKey;
    // Auxiliary field edits must retain the exact same attempt key
    expect(secondKey).toBe(initialKey);
    expect(mockCreateOrg.mock.calls[1][0].phone).toBe('+91 99999 22222');
    expect(mockCreateOrg.mock.calls[1][0].city).toBe('Hyderabad');
  });

  it('14. ERR_IDEMPOTENCY_CONFLICT displays explanation banner, preserves form values, and deliberate confirmation generates new key', async () => {
    mockCreateOrg.mockRejectedValueOnce(
      new Error('ERR_IDEMPOTENCY_CONFLICT: Organization with this idempotency key already exists with different core parameters.')
    );
    mockCreateOrg.mockResolvedValueOnce({
      id: 'org-conflict-resolved-uuid',
      name: 'Pinnacle Distribution',
      currency: 'INR',
      createdAt: '2026-10-30T10:00:00Z',
      updatedAt: '2026-10-30T10:00:00Z',
    });

    render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    const nameInput = screen.getByLabelText(/Distributor Business Name/i);
    const gstinInput = screen.getByLabelText(/GSTIN/i);
    const phoneInput = screen.getByLabelText(/Phone/i);
    const submitBtn = screen.getByRole('button', { name: /Create Organization/i });

    fireEvent.change(nameInput, { target: { value: 'Pinnacle Distribution' } });
    fireEvent.change(gstinInput, { target: { value: '27AAAAA0000A1Z5' } });
    fireEvent.change(phoneInput, { target: { value: '+91 98888 77777' } });

    // Submit triggers conflict error
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(1);
    });

    const conflictKey = mockCreateOrg.mock.calls[0][0].idempotencyKey;

    // Verify conflict alert appears with explanation
    await waitFor(() => {
      expect(screen.getByTestId('idempotency-conflict-alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/Identity Conflict with Previous Attempt/i)).toBeInTheDocument();
    expect(screen.getByText(/Core organization details.*were modified after a previous submission/i)).toBeInTheDocument();

    // Verify submit button is disabled while conflict is active
    expect(submitBtn).toBeDisabled();

    // Verify all form inputs are 100% preserved
    expect((nameInput as HTMLInputElement).value).toBe('Pinnacle Distribution');
    expect((gstinInput as HTMLInputElement).value).toBe('27AAAAA0000A1Z5');
    expect((phoneInput as HTMLInputElement).value).toBe('+91 98888 77777');

    // User clicks "Confirm New Attempt" button
    const confirmBtn = screen.getByRole('button', { name: /Confirm New Attempt/i });
    fireEvent.click(confirmBtn);

    // Verify alert is cleared and toast is displayed
    expect(screen.queryByTestId('idempotency-conflict-alert')).not.toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith(
      'info',
      'New Attempt Initialized',
      expect.stringContaining('Assigned a fresh idempotency key')
    );

    // Submit button is re-enabled
    expect(submitBtn).not.toBeDisabled();

    // Submit again with the new attempt key
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(2);
    });

    const newKey = mockCreateOrg.mock.calls[1][0].idempotencyKey;
    // New key must be freshly generated and different from conflictKey
    expect(newKey).not.toBe(conflictKey);
    // Form values must still be preserved and submitted
    expect(mockCreateOrg.mock.calls[1][0].name).toBe('Pinnacle Distribution');
    expect(mockCreateOrg.mock.calls[1][0].gstin).toBe('27AAAAA0000A1Z5');
    expect(mockCreateOrg.mock.calls[1][0].phone).toBe('+91 98888 77777');

    // Successful submission closes the modal
    await waitFor(() => {
      expect(defaultOnClose).toHaveBeenCalledTimes(1);
    });
  });

  it('Auto-derives 10-character PAN when 15-character Indian GSTIN is entered', () => {
    render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    const gstinInput = screen.getByLabelText(/GSTIN/i);
    const panInput = screen.getByLabelText(/PAN/i);

    // Enter a valid 15-char GSTIN (Chars 3 to 12 are ABCDE1234F)
    fireEvent.change(gstinInput, { target: { value: '29ABCDE1234F1Z5' } });

    expect((panInput as HTMLInputElement).value).toBe('ABCDE1234F');
  });

  it('Validates required organization name and rejects empty submission with toast error', async () => {
    render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    const nameInput = screen.getByLabelText(/Distributor Business Name/i);
    fireEvent.change(nameInput, { target: { value: '   ' } });

    const submitBtn = screen.getByRole('button', { name: /Create Organization/i });
    fireEvent.click(submitBtn);

    expect(mockCreateOrg).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      'error',
      'Organization Name Required',
      'Please enter a valid organization name.'
    );
    expect(defaultOnClose).not.toHaveBeenCalled();
  });

  it('Submits business eligibility parameters with default and custom values', async () => {
    mockCreateOrg.mockResolvedValueOnce({
      id: 'org-eligibility-modal-uuid',
      name: 'Pioneer Wholesale Cables',
      currency: 'INR',
      createdAt: '2026-10-31T10:00:00Z',
      updatedAt: '2026-10-31T10:00:00Z',
    });

    render(<NewOrgModal isOpen={true} onClose={defaultOnClose} />);

    fireEvent.change(screen.getByLabelText(/Distributor Business Name/i), {
      target: { value: 'Pioneer Wholesale Cables' },
    });

    // Select Hardware & Electrical Store
    const categorySelect = screen.getByLabelText(/Business Category/i);
    fireEvent.change(categorySelect, { target: { value: 'hardware_electrical' } });

    const submitBtn = screen.getByRole('button', { name: /Create Organization/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateOrg).toHaveBeenCalledTimes(1);
      const payload = mockCreateOrg.mock.calls[0][0];
      expect(payload.name).toBe('Pioneer Wholesale Cables');
      expect(payload.businessCategory).toBe('hardware_electrical');
      expect(payload.sellsElectricalProducts).toBe(true);
      expect(payload.productLines).toEqual(['Wires & Cables', 'Switches & Sockets']);
    });
  });
});
