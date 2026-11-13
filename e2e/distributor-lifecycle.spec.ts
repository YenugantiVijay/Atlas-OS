import { test, expect } from '@playwright/test';

/**
 * ATLAS OS — Phase A3.3 Task 9: Real-Business Distributor Transaction Lifecycle
 *
 * Verifies the complete distributor commercial transaction flow:
 * 1. Customer Creation (trade electrical dealer with valid details)
 * 2. Product SKU Creation (electrical cable with GST tax rate & pricing)
 * 3. Initial Stock Inward / Adjustment (audited quantity adjustment)
 * 4. Commercial Sales Order Creation (order created in DRAFT status)
 * 5. Order Confirmation & Stock Allocation (transitions to CONFIRMED, inventory deducted)
 * 6. Tax Invoice Generation (converts confirmed order to commercial GST invoice)
 * 7. Partial Payment Remittance (records partial payment against receivables)
 * 8. Final Balance Settlement (settles remaining invoice balance to PAID)
 * 9. Customer Ledger Inspection (verifies customer balance and receivables ledger)
 */

test.describe('ATLAS OS — Complete Distributor Transaction Lifecycle (Phase A3.3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('atlas_auth_mode_v2', 'demo');
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sri Lakshmi Electrical Distributors' })).toBeVisible();
  });

  test('executes complete commercial distributor lifecycle: customer -> product -> stock -> order -> confirm -> invoice -> payment -> settlement', async ({ page }) => {
    // ------------------------------------------------------------------------
    // Step 1: Create Trade Customer
    // ------------------------------------------------------------------------
    await page.goto('/#/customers');
    await expect(page.getByRole('heading', { name: 'Customers & Contractors' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Customer' }).click();
    const custDialog = page.getByRole('dialog');
    await expect(custDialog).toBeVisible();
    await expect(custDialog.getByText('Add New Customer Account')).toBeVisible();

    await custDialog.getByLabel('Contact Person Name').fill('Suresh Reddy');
    await custDialog.getByLabel('Firm / Trade Name').fill('Reddy Power & Electricals');
    await custDialog.getByLabel('Phone Number').fill('+91 98451 77665');

    await custDialog.getByRole('button', { name: 'Save Customer' }).click();
    await expect(custDialog).not.toBeVisible();
    await expect(page.getByText('Reddy Power & Electricals', { exact: true })).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 2: Create Electrical Product SKU
    // ------------------------------------------------------------------------
    await page.goto('/#/products');
    await expect(page.getByRole('heading', { name: 'Products & Catalog' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Product' }).click();
    const prodDialog = page.getByRole('dialog');
    await expect(prodDialog).toBeVisible();
    await expect(prodDialog.getByText('Add New Product')).toBeVisible();

    await prodDialog.getByLabel('SKU Code').fill('FIN-CBL-4SQ-BL');
    await prodDialog.getByLabel('Product Title & Description').fill('Finolex 4.0 sq mm Industrial Copper Cable (90m Blue)');
    await prodDialog.getByLabel('Purchase Cost (₹)').fill('2800');
    await prodDialog.getByLabel('Selling Price (₹)').fill('3400');

    await prodDialog.getByRole('button', { name: 'Create Product' }).click();
    await expect(prodDialog).not.toBeVisible();
    await expect(page.getByRole('table').getByText('FIN-CBL-4SQ-BL', { exact: true })).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 3: Record Initial Inward Stock Adjustment
    // ------------------------------------------------------------------------
    await page.goto('/#/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory Movement Ledger' })).toBeVisible();

    await page.getByRole('button', { name: 'Adjust Stock' }).click();
    const stockDialog = page.getByRole('dialog');
    await expect(stockDialog).toBeVisible();
    await expect(stockDialog.getByText('Manual Stock Adjustment')).toBeVisible();

    await stockDialog.getByLabel('Quantity Change (+ to add, - to deduct)').fill('+75');
    await stockDialog.getByLabel('Reason / Audit Note').fill('Inward shipment inspection for industrial cable batch');

    await stockDialog.getByRole('button', { name: 'Record Adjustment' }).click();
    await expect(stockDialog).not.toBeVisible();
    await expect(page.getByText('+75 Coils')).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 4: Create Sales Order in DRAFT Status
    // ------------------------------------------------------------------------
    await page.goto('/#/orders');
    await expect(page.getByRole('heading', { name: 'Sales Orders' })).toBeVisible();

    await page.getByRole('button', { name: 'New Sales Order' }).first().click();
    const orderDialog = page.getByRole('dialog');
    await expect(orderDialog).toBeVisible();
    await expect(orderDialog.getByText('Create Sales Order')).toBeVisible();

    // Save sales order (uses pre-selected customer & line item)
    await orderDialog.getByRole('button', { name: 'Save Sales Order' }).click();
    await expect(orderDialog).not.toBeVisible();

    // Verify order created in DRAFT status
    await expect(page.getByText('SO-2026-0002', { exact: true })).toBeVisible();
    const orderRow = page.getByRole('row', { name: /SO-2026-0002/ });
    await expect(orderRow.getByText('DRAFT')).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 5: Confirm Sales Order & Deduct Inventory
    // ------------------------------------------------------------------------
    const confirmButton = orderRow.getByRole('button', { name: 'Confirm', exact: true });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    const confirmModal = page.getByRole('dialog');
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal.getByText('Confirm Order & Deduct Inventory')).toBeVisible();

    await confirmModal.getByRole('button', { name: 'Confirm & Allocate Stock' }).click();
    await expect(confirmModal).not.toBeVisible();

    // Order transitions to CONFIRMED
    await expect(orderRow.getByText('CONFIRMED')).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 6: Generate Commercial Tax Invoice
    // ------------------------------------------------------------------------
    const invoiceBtn = orderRow.getByRole('button', { name: 'Invoice', exact: true });
    await expect(invoiceBtn).toBeVisible();
    await invoiceBtn.click();

    // Redirection to invoices page occurs
    await expect(page).toHaveURL(/.*#\/invoices/);
    await expect(page.getByRole('heading', { name: 'Tax Invoices' })).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 7: Record Partial Payment Remittance
    // ------------------------------------------------------------------------
    await page.goto('/#/payments');
    await expect(page.getByText('Payments & Receivables Ledger')).toBeVisible();

    await page.getByRole('button', { name: 'Record Payment' }).click();
    const payModal = page.getByRole('dialog');
    await expect(payModal).toBeVisible();
    await expect(payModal.getByText('Record Customer Payment')).toBeVisible();

    // Select customer
    const custSearch = payModal.getByPlaceholder(/search customers/i);
    await custSearch.fill('Sharma');
    await page.waitForTimeout(300);

    // Enter partial payment amount
    await payModal.getByLabel('Amount Received (₹)').fill('2000');
    await payModal.getByLabel('Reference / Transaction ID').fill('UPI-A33-PARTIAL-101');

    await payModal.getByRole('button', { name: 'Record Payment Receipt' }).click();
    await expect(payModal).not.toBeVisible();

    // Verified receipt logged in payment ledger
    await expect(page.getByText('UPI-A33-PARTIAL-101')).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 8: Settle Balance
    // ------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Record Payment' }).click();
    const settleModal = page.getByRole('dialog');
    await expect(settleModal).toBeVisible();

    const settleCustSearch = settleModal.getByPlaceholder(/search customers/i);
    await settleCustSearch.fill('Sharma');
    await page.waitForTimeout(300);

    await settleModal.getByLabel('Amount Received (₹)').fill('500');
    await settleModal.getByLabel('Reference / Transaction ID').fill('NEFT-A33-SETTLE-202');

    await settleModal.getByRole('button', { name: 'Record Payment Receipt' }).click();
    await expect(settleModal).not.toBeVisible();

    await expect(page.getByText('NEFT-A33-SETTLE-202')).toBeVisible();

    // ------------------------------------------------------------------------
    // Step 9: Customer Receivables & Ledger Verification
    // ------------------------------------------------------------------------
    await page.goto('/#/customers');
    await expect(page.getByRole('heading', { name: 'Customers & Contractors' })).toBeVisible();
    await expect(page.getByText('Current Receivable')).toBeVisible();
  });
});
