/**
 * ATLAS OS — Bharat UPI QR & Instant Payment Link Engine
 *
 * Implements NPCI-compliant Bharat UPI deep link and QR data generation
 * for dynamic invoice settlement at retail billing counters and PDF prints.
 */

import { Organization, Invoice } from '@/types';
import { calculateInvoiceBalance } from './money';

export interface BharatUpiParams {
  payeeVpa: string;
  payeeName: string;
  amount?: number;
  transactionRef?: string;
  transactionNote?: string;
}

export const upiQr = {
  /**
   * Validates UPI Virtual Payment Address (VPA) / UPI ID format.
   * Standard format: [handle]@[bank/psp] (e.g. dealer@okaxis, 9876543210@paytm, shop@icici).
   */
  validateVpa(vpa: string): { valid: boolean; error?: string } {
    if (!vpa || typeof vpa !== 'string') {
      return { valid: false, error: 'UPI ID is required.' };
    }
    const trimmed = vpa.trim().toLowerCase();
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
    if (!upiRegex.test(trimmed)) {
      return {
        valid: false,
        error: 'Invalid UPI ID format. Example: businessname@hdfcbank or 9876543210@paytm.',
      };
    }
    return { valid: true };
  },

  /**
   * Generates official NPCI Bharat UPI deep link string.
   * Format: upi://pay?pa={vpa}&pn={name}&am={amount}&tr={ref}&tn={note}&cu=INR
   */
  generateBharatUpiUri(params: BharatUpiParams): string {
    const { payeeVpa, payeeName, amount, transactionRef, transactionNote } = params;

    const vpaCheck = this.validateVpa(payeeVpa);
    if (!vpaCheck.valid) {
      throw new Error(vpaCheck.error);
    }

    const searchParams = new URLSearchParams();
    searchParams.set('pa', payeeVpa.trim());
    searchParams.set('pn', payeeName.trim().substring(0, 50));
    searchParams.set('cu', 'INR');

    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
      throw new Error('Payment amount must be greater than zero.');
    }

    if (amount !== undefined) {
      searchParams.set('am', amount.toFixed(2));
    }

    if (transactionRef) {
      searchParams.set('tr', transactionRef.trim().substring(0, 35));
    }

    if (transactionNote) {
      searchParams.set('tn', transactionNote.trim().substring(0, 80));
    }

    return `upi://pay?${searchParams.toString()}`;
  },

  /**
   * Generates dynamic UPI payment parameters for an unpaid or partially paid tax invoice.
   */
  getInvoiceUpiPaymentInfo(
    org: Organization,
    invoice: Invoice,
    fallbackVpa?: string
  ): {
    upiUri: string;
    amountPayable: number;
    payeeVpa: string;
    payeeName: string;
  } {
    const vpa = fallbackVpa?.trim();
    if (!vpa) {
      throw new Error("Configure the organization's verified UPI ID before generating a payment link.");
    }
    const balance = calculateInvoiceBalance(invoice.totalAmount, invoice.totalPaid);
    if (balance <= 0) {
      throw new Error('This invoice has no outstanding balance.');
    }

    const upiUri = this.generateBharatUpiUri({
      payeeVpa: vpa,
      payeeName: org.name,
      amount: balance,
      transactionRef: invoice.invoiceNumber.replace(/[^a-zA-Z0-9]/g, '').substring(0, 30),
      transactionNote: `Payment for Inv ${invoice.invoiceNumber}`,
    });

    return {
      upiUri,
      amountPayable: balance,
      payeeVpa: vpa,
      payeeName: org.name,
    };
  },
};
