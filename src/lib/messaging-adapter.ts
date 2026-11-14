/**
 * ATLAS OS — Indian Business Messaging & WhatsApp Share Adapter
 *
 * Generates direct click-to-chat links and formatted SMS/WhatsApp templates
 * for invoices, quotations, and payment receipt confirmations.
 */

import { Invoice, Quotation, Payment } from '@/types';
import { formatCurrency, calculateInvoiceBalance } from './money';

export const messagingAdapter = {
  /**
   * Sanitizes Indian phone numbers into standard international format (without + or leading 0).
   */
  sanitizeIndianPhoneNumber(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith('91')) {
      return digits;
    }
    return digits;
  },

  /**
   * Generates WhatsApp sharing link for an invoice with payment details.
   */
  generateWhatsAppInvoiceLink(
    customerPhone: string,
    orgName: string,
    invoice: Invoice,
    upiUri?: string
  ): string {
    const phone = this.sanitizeIndianPhoneNumber(customerPhone);
    const balance = calculateInvoiceBalance(invoice.totalAmount, invoice.totalPaid);

    let text = `*Tax Invoice from ${orgName}*\n\n` +
      `Dear Customer,\n` +
      `Your tax invoice *#${invoice.invoiceNumber}* dated ${invoice.invoiceDate} has been generated.\n\n` +
      `• *Total Amount:* ${formatCurrency(invoice.totalAmount)}\n` +
      `• *Balance Due:* ${formatCurrency(balance)}\n` +
      `• *Payment Due Date:* ${invoice.dueDate}\n\n`;

    if (balance > 0 && upiUri) {
      text += `📲 *Pay instantly via UPI:*\n${upiUri}\n\n`;
    }

    text += `Thank you for your business!\n— ${orgName}`;

    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  },

  /**
   * Generates WhatsApp sharing link for an estimate / quotation.
   */
  generateWhatsAppQuotationLink(
    customerPhone: string,
    orgName: string,
    quotation: Quotation
  ): string {
    const phone = this.sanitizeIndianPhoneNumber(customerPhone);

    const text = `*Price Quotation from ${orgName}*\n\n` +
      `Dear Contractor/Customer,\n` +
      `Please find attached our price estimate *#${quotation.quotationNumber}* dated ${quotation.createdAt.split('T')[0]}.\n\n` +
      `• *Estimated Total:* ${formatCurrency(quotation.totalAmount)}\n` +
      `• *Validity:* ${quotation.validUntil ? quotation.validUntil : '15 days from issue'}\n\n` +
      `Please reply with your approval or purchase order to schedule dispatch.\n\n` +
      `Thank you!\n— ${orgName}`;

    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  },

  /**
   * Generates WhatsApp acknowledgment link for a recorded payment receipt.
   */
  generateWhatsAppReceiptLink(
    customerPhone: string,
    orgName: string,
    payment: Payment,
    invoiceNumber?: string
  ): string {
    const phone = this.sanitizeIndianPhoneNumber(customerPhone);

    const text = `*Payment Receipt Confirmation — ${orgName}*\n\n` +
      `Dear Customer,\n` +
      `We gratefully acknowledge receipt of *${formatCurrency(payment.amount)}* via *${payment.paymentMethod}* ` +
      `on ${payment.paymentDate}.\n\n` +
      `• *Receipt Reference:* ${payment.referenceNumber || payment.id.substring(0, 8)}\n` +
      (invoiceNumber ? `• *Applied against Invoice:* #${invoiceNumber}\n\n` : `\n`) +
      `Your ledger has been updated.\n\n` +
      `Thank you!\n— ${orgName}`;

    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  },
};
