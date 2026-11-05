import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  sanitizeExcelText,
  generateSalesReceiptsWorkbook,
  WorkbookPayload,
  ReportCriteria,
} from './excel';
import { Organization, Invoice, Payment, Customer } from '@/types';

describe('Excel Financial Reporting & Workbook Engine', () => {
  describe('Formula Injection Protection (sanitizeExcelText)', () => {
    it('prepends single quote to strings starting with formula prefixes (=, +, -, @)', () => {
      expect(sanitizeExcelText('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(sanitizeExcelText('+cmd| /C calc')).toBe("'+cmd| /C calc");
      expect(sanitizeExcelText('-5+2')).toBe("'-5+2");
      expect(sanitizeExcelText('@HYPERLINK("http://attacker.com")')).toBe("'@HYPERLINK(\"http://attacker.com\")");
    });

    it('prepends single quote to strings starting with whitespace/pipe/percent (\t, \r, |, %)', () => {
      expect(sanitizeExcelText('\tmalicious')).toBe("'\tmalicious");
      expect(sanitizeExcelText('\rmalicious')).toBe("'\rmalicious");
      expect(sanitizeExcelText('|calc.exe')).toBe("'|calc.exe");
      expect(sanitizeExcelText('%test')).toBe("'%test");
    });

    it('leaves standard trade strings completely untouched', () => {
      expect(sanitizeExcelText('Sri Devi Electricals')).toBe('Sri Devi Electricals');
      expect(sanitizeExcelText('INV-2026-0001')).toBe('INV-2026-0001');
      expect(sanitizeExcelText('Polycab 2.5 sqmm FR PVC Copper Wire')).toBe('Polycab 2.5 sqmm FR PVC Copper Wire');
      expect(sanitizeExcelText('37AAAAA0000A1Z5')).toBe('37AAAAA0000A1Z5');
    });

    it('safely handles null, undefined, empty strings, and numbers', () => {
      expect(sanitizeExcelText(null)).toBe('');
      expect(sanitizeExcelText(undefined)).toBe('');
      expect(sanitizeExcelText('')).toBe('');
      expect(sanitizeExcelText(12345)).toBe('12345');
    });
  });

  describe('Workbook Generation & Structure Verification (Real ExcelJS Reader)', () => {
    const mockOrg: Organization = {
      id: 'org-test-uuid-001',
      name: 'Sri Devi Electrical Distributors',
      legalName: 'Sri Devi Electrical Distributors Private Limited',
      gstin: '37AAAAA1234A1Z5', // Andhra Pradesh (37)
      pan: 'AAAAA1234A',
      phone: '9876543210',
      email: 'accounts@sridevi-elec.com',
      addressLine1: '45-12 Trunk Road',
      city: 'Visakhapatnam',
      state: 'Andhra Pradesh',
      pincode: '530001',
      currency: 'INR',
      createdAt: '2025-04-01T00:00:00Z',
      updatedAt: '2025-04-01T00:00:00Z',
    };

    const mockCustomerIntra: Customer = {
      id: 'cust-uuid-intra-01',
      organizationId: mockOrg.id,
      name: 'Gayatri Electricals',
      companyName: 'Gayatri Electricals & Hardware',
      phone: '9123456780',
      email: 'gayatri@gmail.com',
      billingAddress: 'Gajuwaka, Visakhapatnam, Andhra Pradesh',
      gstin: '37BBBBB5678B1Z2', // AP (Intra-state)
      pan: 'BBBBB5678B',
      creditLimit: 200000,
      creditDays: 30,
      isActive: true,
      createdAt: '2025-04-01T00:00:00Z',
      updatedAt: '2025-04-01T00:00:00Z',
    };

    const mockCustomerInter: Customer = {
      id: 'cust-uuid-inter-02',
      organizationId: mockOrg.id,
      name: 'Kavitha Controls Hyderabad',
      companyName: 'Kavitha Controls Telangana Pvt Ltd',
      phone: '9876500000',
      billingAddress: 'Balanagar, Hyderabad, Telangana',
      gstin: '36CCCCC9999C1Z1', // Telangana (36 -> Inter-state)
      pan: 'CCCCC9999C',
      creditLimit: 500000,
      creditDays: 45,
      isActive: true,
      createdAt: '2025-04-01T00:00:00Z',
      updatedAt: '2025-04-01T00:00:00Z',
    };

    const mockInvoices: Invoice[] = [
      {
        id: 'inv-uuid-001',
        organizationId: mockOrg.id,
        invoiceNumber: 'INV-2025-001',
        customerId: mockCustomerIntra.id,
        customer: mockCustomerIntra,
        status: 'PAID',
        invoiceDate: '2025-05-10',
        dueDate: '2025-06-09',
        subtotal: 10000,
        discountAmount: 0,
        taxAmount: 1800,
        totalAmount: 11800,
        totalPaid: 11800,
        notes: 'Full payment received via NEFT',
        createdAt: '2025-05-10T10:00:00Z',
        updatedAt: '2025-05-15T10:00:00Z',
        items: [
          {
            id: 'item-1',
            invoiceId: 'inv-uuid-001',
            productId: 'prod-1',
            productName: 'Polycab 2.5 sqmm FR PVC Copper Wire',
            productSku: 'CBL-CU-25',
            hsnCode: '8544',
            uom: 'Coils',
            quantity: 5,
            unitPrice: 2000,
            discountPercent: 0,
            taxRate: 18,
            lineSubtotal: 10000,
            lineTax: 1800,
            lineTotal: 11800,
          },
        ],
      },
      {
        id: 'inv-uuid-002',
        organizationId: mockOrg.id,
        invoiceNumber: 'INV-2025-002',
        customerId: mockCustomerInter.id,
        customer: mockCustomerInter,
        status: 'PARTIALLY_PAID',
        invoiceDate: '2025-05-20',
        dueDate: '2025-06-19',
        subtotal: 20000,
        discountAmount: 1000,
        taxAmount: 3420,
        totalAmount: 22420,
        totalPaid: 10000,
        notes: 'Partial payment of 10k made',
        createdAt: '2025-05-20T10:00:00Z',
        updatedAt: '2025-05-25T10:00:00Z',
        items: [
          {
            id: 'item-2',
            invoiceId: 'inv-uuid-002',
            productId: 'prod-2',
            productName: 'Schneider Acti9 32A TP MCB',
            productSku: 'SW-MCB-32TP',
            hsnCode: '8536',
            uom: 'Nos',
            quantity: 10,
            unitPrice: 1200,
            discountPercent: 5,
            taxRate: 18,
            lineSubtotal: 11400,
            lineTax: 2052,
            lineTotal: 13452,
            documentDiscountShare: 600,
          },
          {
            id: 'item-3',
            invoiceId: 'inv-uuid-002',
            productId: 'prod-3',
            productName: 'Havells 25A 30mA 4P RCCB',
            productSku: 'SW-RCCB-25-4P',
            hsnCode: '8536',
            uom: 'Nos',
            quantity: 5,
            unitPrice: 1600,
            discountPercent: 5,
            taxRate: 18,
            lineSubtotal: 7600,
            lineTax: 1368,
            lineTotal: 8968,
            documentDiscountShare: 400,
          },
        ],
      },
      {
        id: 'inv-uuid-003',
        organizationId: mockOrg.id,
        invoiceNumber: 'INV-2025-003',
        customerId: mockCustomerIntra.id,
        customer: mockCustomerIntra,
        status: 'CANCELLED',
        invoiceDate: '2025-05-22',
        dueDate: '2025-06-21',
        subtotal: 5000,
        discountAmount: 0,
        taxAmount: 900,
        totalAmount: 5900,
        totalPaid: 0,
        notes: 'Cancelled due to pricing dispute',
        createdAt: '2025-05-22T10:00:00Z',
        updatedAt: '2025-05-22T11:00:00Z',
        items: [
          {
            id: 'item-4',
            invoiceId: 'inv-uuid-003',
            productId: 'prod-1',
            productName: 'Polycab 2.5 sqmm FR PVC Copper Wire',
            productSku: 'CBL-CU-25',
            uom: 'Coils',
            quantity: 2,
            unitPrice: 2500,
            discountPercent: 0,
            taxRate: 18,
            lineSubtotal: 5000,
            lineTax: 900,
            lineTotal: 5900,
          },
        ],
      },
    ];

    const mockPayments: Payment[] = [
      {
        id: 'pay-uuid-001',
        organizationId: mockOrg.id,
        paymentNumber: 'REC-2025-001',
        customerId: mockCustomerIntra.id,
        customer: mockCustomerIntra,
        amount: 11800,
        paymentMethod: 'NEFT',
        referenceNumber: 'NEFT987654321',
        paymentDate: '2025-05-15',
        notes: 'Settlement for INV-2025-001',
        createdAt: '2025-05-15T11:00:00Z',
        allocations: [
          {
            id: 'alloc-1',
            paymentId: 'pay-uuid-001',
            invoiceId: 'inv-uuid-001',
            amountAllocated: 11800,
            createdAt: '2025-05-15T11:00:00Z',
            invoice: mockInvoices[0],
          },
        ],
      },
      {
        id: 'pay-uuid-002',
        organizationId: mockOrg.id,
        paymentNumber: 'REC-2025-002',
        customerId: mockCustomerInter.id,
        customer: mockCustomerInter,
        amount: 15000,
        paymentMethod: 'UPI',
        referenceNumber: 'UPI555123456789',
        paymentDate: '2025-05-25',
        notes: 'Partial payment with advance unallocated',
        createdAt: '2025-05-25T14:00:00Z',
        allocations: [
          {
            id: 'alloc-2',
            paymentId: 'pay-uuid-002',
            invoiceId: 'inv-uuid-002',
            amountAllocated: 10000,
            createdAt: '2025-05-25T14:00:00Z',
            invoice: mockInvoices[1],
          },
        ],
      },
    ];

    it('generates a valid, readable .xlsx workbook with all 5 worksheets and correct metadata', async () => {
      const criteria: ReportCriteria = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
        isDemoMode: false,
      };

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria,
        invoices: mockInvoices,
        payments: mockPayments,
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      expect(buffer).toBeDefined();
      expect(buffer.byteLength).toBeGreaterThan(1000);

      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const sheetNames = reader.worksheets.map((ws) => ws.name);
      expect(sheetNames).toEqual([
        'Reconciliation',
        'Invoice Summary',
        'Invoice Products',
        'Payment Receipts',
        'Payment Allocations',
      ]);
    });

    it('validates Reconciliation worksheet financial integrity and disclosures', async () => {
      const criteria: ReportCriteria = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
        isDemoMode: false,
      };

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria,
        invoices: mockInvoices,
        payments: mockPayments,
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const reconSheet = reader.getWorksheet('Reconciliation');
      expect(reconSheet).toBeDefined();

      const cellValues: string[] = [];
      reconSheet?.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value) cellValues.push(String(cell.value));
        });
      });

      expect(cellValues).toContain('Sri Devi Electrical Distributors Private Limited');
      expect(cellValues).toContain('37AAAAA1234A1Z5');
      expect(cellValues).toContain('Total Recognized Invoices');
      expect(cellValues).toContain('Total Payment Receipts in Selected Period');
      expect(cellValues).toContain('Period Isolation Notice');
      expect(cellValues).toContain('Statutory GST Component Disclosure');
      expect(cellValues).toContain('Historical Snapshot Guarantee');
    });

    it('validates Invoice Summary worksheet row counts, formatting and totals', async () => {
      const criteria: ReportCriteria = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
        isDemoMode: false,
      };

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria,
        invoices: mockInvoices,
        payments: mockPayments,
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const invSheet = reader.getWorksheet('Invoice Summary');
      expect(invSheet).toBeDefined();

      // Top 4 rows: Title, Subtitle, blank, Table Header
      // Rows 5, 6, 7: 3 Invoices
      // Row 8: Summary Total Row
      expect(invSheet?.rowCount).toBe(8);

      // Verify Header row (Row 4)
      const headerRow = invSheet?.getRow(4);
      expect(headerRow?.getCell(4).value).toBe('Invoice Number');
      expect(headerRow?.getCell(16).value).toBe('Grand Total (₹)');

      // Verify Row 5 (INV-2025-001) - PAID
      const row1 = invSheet?.getRow(5);
      expect(row1?.getCell(4).value).toBe('INV-2025-001');
      expect(row1?.getCell(12).value).toBe('PAID');
      expect(row1?.getCell(16).value).toBe(11800);
      expect(row1?.getCell(17).value).toBe(11800);
      expect(row1?.getCell(18).value).toBe(0); // Outstanding = 0

      // Verify Row 6 (INV-2025-002) - PARTIALLY_PAID
      const row2 = invSheet?.getRow(6);
      expect(row2?.getCell(4).value).toBe('INV-2025-002');
      expect(row2?.getCell(12).value).toBe('PARTIALLY_PAID');
      expect(row2?.getCell(16).value).toBe(22420);
      expect(row2?.getCell(17).value).toBe(10000);
      expect(row2?.getCell(18).value).toBe(12420); // 22420 - 10000 = 12420

      // Verify Row 7 (INV-2025-003) - CANCELLED (Outstanding is 0, not added to receivables)
      const row3 = invSheet?.getRow(7);
      expect(row3?.getCell(4).value).toBe('INV-2025-003');
      expect(row3?.getCell(12).value).toBe('CANCELLED');
      expect(row3?.getCell(18).value).toBe(0); // Cancelled balance is 0

      // Verify Total Row (Row 8)
      const totalRow = invSheet?.getRow(8);
      expect(totalRow?.getCell(1).value).toBe('TOTAL');
      expect(totalRow?.getCell(16).value).toBe(11800 + 22420 + 5900); // 40120
      expect(totalRow?.getCell(17).value).toBe(11800 + 10000); // 21800
      expect(totalRow?.getCell(18).value).toBe(12420); // Outstanding strictly excludes cancelled invoice
    });

    it('validates Invoice Products worksheet lines, multi-item join and GST resolution', async () => {
      const criteria: ReportCriteria = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
        isDemoMode: false,
      };

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria,
        invoices: mockInvoices,
        payments: mockPayments,
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const prodSheet = reader.getWorksheet('Invoice Products');
      expect(prodSheet).toBeDefined();

      // Top 4 rows + 4 total line items across 3 invoices + 1 Total row = 9 rows
      expect(prodSheet?.rowCount).toBe(9);

      // Row 5: Item 1 of INV-001
      const r1 = prodSheet?.getRow(5);
      expect(r1?.getCell(1).value).toBe('INV-2025-001');
      expect(r1?.getCell(5).value).toBe('Polycab 2.5 sqmm FR PVC Copper Wire');
      expect(r1?.getCell(9).value).toBe(5); // Qty
      expect(r1?.getCell(10).value).toBe(2000); // Unit price
      expect(r1?.getCell(13).value).toBe(10000); // Line Subtotal
      expect(r1?.getCell(14).value).toBe(0.18); // Tax rate 18%
      expect(r1?.getCell(15).value).toBe(1800); // Tax amount 1800
      expect(r1?.getCell(16).value).toBe(11800); // Line Total
      expect(r1?.getCell(17).value).toBe('Historical Component Split Not Stored');
      expect(r1?.getCell(18).value).toBe('Not Stored'); // CGST
      expect(r1?.getCell(19).value).toBe('Not Stored'); // SGST
      expect(r1?.getCell(20).value).toBe('Not Stored'); // IGST

      // Summary row
      const totalRow = prodSheet?.getRow(9);
      expect(totalRow?.getCell(1).value).toBe('TOTAL');
      expect(totalRow?.getCell(15).value).toBe(1800 + 2052 + 1368 + 900); // 6120 total tax
      expect(totalRow?.getCell(16).value).toBe(11800 + 13452 + 8968 + 5900); // 40120 total
    });

    it('validates Payment Receipts and Payment Allocations worksheets', async () => {
      const criteria: ReportCriteria = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
        isDemoMode: false,
      };

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria,
        invoices: mockInvoices,
        payments: mockPayments,
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const paySheet = reader.getWorksheet('Payment Receipts');
      expect(paySheet).toBeDefined();
      expect(paySheet?.rowCount).toBe(7);

      const r1 = paySheet?.getRow(5);
      expect(r1?.getCell(1).value).toBe('REC-2025-001');
      expect(r1?.getCell(3).value).toBe('pay-uuid-001');
      expect(r1?.getCell(7).value).toBe('NEFT');
      expect(r1?.getCell(9).value).toBe(11800);
      expect(r1?.getCell(10).value).toBe(11800); // Allocated
      expect(r1?.getCell(11).value).toBe(0);     // Unallocated

      const r2 = paySheet?.getRow(6);
      expect(r2?.getCell(1).value).toBe('REC-2025-002');
      expect(r2?.getCell(7).value).toBe('UPI');
      expect(r2?.getCell(9).value).toBe(15000);
      expect(r2?.getCell(10).value).toBe(10000); // Allocated
      expect(r2?.getCell(11).value).toBe(5000);  // Unallocated advance

      // Allocations sheet
      const allocSheet = reader.getWorksheet('Payment Allocations');
      expect(allocSheet).toBeDefined();
      expect(allocSheet?.rowCount).toBe(7);
      const a1 = allocSheet?.getRow(5);
      expect(a1?.getCell(2).value).toBe('REC-2025-001');
      expect(a1?.getCell(6).value).toBe('INV-2025-001');
      expect(a1?.getCell(7).value).toBe('2025-05-10'); // Invoice Date
      expect(a1?.getCell(10).value).toBe(11800);
    });

    it('resolves cross-period payment allocations via referencedInvoices', async () => {
      const crossPeriodPayment: Payment = {
        id: 'pay-cross-1',
        organizationId: mockOrg.id,
        paymentNumber: 'REC-2025-MAY-99',
        customerId: mockCustomerIntra.id,
        amount: 25000,
        paymentMethod: 'RTGS',
        paymentDate: '2025-05-18',
        createdAt: '2025-05-18T10:00:00Z',
        allocations: [
          {
            id: 'alloc-hist-1',
            paymentId: 'pay-cross-1',
            invoiceId: 'inv-historical-2023-999',
            amountAllocated: 25000,
            createdAt: '2025-05-18T10:00:00Z',
          },
        ],
      };

      const referencedMap = new Map([
        [
          'inv-historical-2023-999',
          {
            id: 'inv-historical-2023-999',
            invoiceNumber: 'INV-HIST-2023-088',
            invoiceDate: '2023-08-15',
            status: 'PAID',
          },
        ],
      ]);

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria: {
          periodType: 'FY',
          periodLabel: 'FY 2025–26',
          startDate: '2025-04-01',
          endDate: '2026-03-31',
          documentType: 'PAYMENTS',
          isDemoMode: false,
        },
        invoices: [],
        payments: [crossPeriodPayment],
        referencedInvoices: referencedMap,
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const allocSheet = reader.getWorksheet('Payment Allocations');
      const row = allocSheet?.getRow(5);
      expect(row?.getCell(2).value).toBe('REC-2025-MAY-99');
      expect(row?.getCell(6).value).toBe('INV-HIST-2023-088');
      expect(row?.getCell(7).value).toBe('2023-08-15');
      expect(row?.getCell(10).value).toBe(25000);
    });

    it('respects documentType: "INVOICES" and omits payment sheets', async () => {
      const criteria: ReportCriteria = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'INVOICES',
        isDemoMode: false,
      };

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria,
        invoices: mockInvoices,
        payments: mockPayments,
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const sheetNames = reader.worksheets.map((ws) => ws.name);
      expect(sheetNames).toEqual(['Reconciliation', 'Invoice Summary', 'Invoice Products']);
      expect(reader.getWorksheet('Payment Receipts')).toBeUndefined();
    });

    it('respects documentType: "PAYMENTS" and omits invoice sheets', async () => {
      const criteria: ReportCriteria = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'PAYMENTS',
        isDemoMode: false,
      };

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria,
        invoices: mockInvoices,
        payments: mockPayments,
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const sheetNames = reader.worksheets.map((ws) => ws.name);
      expect(sheetNames).toEqual(['Reconciliation', 'Payment Receipts', 'Payment Allocations']);
      expect(reader.getWorksheet('Invoice Summary')).toBeUndefined();
    });

    it('handles empty periods gracefully with 0 rows and zeroed totals without crashing', async () => {
      const criteria: ReportCriteria = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
        isDemoMode: false,
      };

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria,
        invoices: [],
        payments: [],
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const invSheet = reader.getWorksheet('Invoice Summary');
      expect(invSheet?.rowCount).toBe(5); // Header (4) + Total row (1)
      const totalRow = invSheet?.getRow(5);
      expect(totalRow?.getCell(16).value).toBe(0);
      expect(totalRow?.getCell(17).value).toBe(0);
      expect(totalRow?.getCell(18).value).toBe(0);
    });

    it('flags DEMO MODE in Reconciliation worksheet when isDemoMode is true', async () => {
      const criteria: ReportCriteria = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
        isDemoMode: true,
      };

      const payload: WorkbookPayload = {
        organization: mockOrg,
        criteria,
        invoices: [],
        payments: [],
      };

      const buffer = await generateSalesReceiptsWorkbook(payload);
      const reader = new ExcelJS.Workbook();
      await reader.xlsx.load(buffer);

      const reconSheet = reader.getWorksheet('Reconciliation');
      let foundDemoFlag = false;
      reconSheet?.eachRow((row) => {
        row.eachCell((cell) => {
          if (String(cell.value).includes('DEMO MODE')) {
            foundDemoFlag = true;
          }
        });
      });

      expect(foundDemoFlag).toBe(true);
    });

    it('measures very large export memory behavior and performance (1,000 invoices)', async () => {
      const largeInvoices: Invoice[] = [];
      const largePayments: Payment[] = [];

      for (let i = 1; i <= 1000; i++) {
        largeInvoices.push({
          id: `inv-large-${i}`,
          organizationId: mockOrg.id,
          invoiceNumber: `INV-LG-${String(i).padStart(5, '0')}`,
          customerId: `cust-${i % 20}`,
          status: i % 2 === 0 ? 'PAID' : 'ISSUED',
          invoiceDate: '2025-06-15',
          dueDate: '2025-07-15',
          subtotal: 5000,
          discountAmount: 250,
          taxAmount: 855,
          totalAmount: 5605,
          totalPaid: i % 2 === 0 ? 5605 : 0,
          createdAt: '2025-06-15T10:00:00Z',
          updatedAt: '2025-06-15T10:00:00Z',
          items: [
            {
              id: `item-lg-${i}-1`,
              invoiceId: `inv-large-${i}`,
              productName: 'Polycab 2.5mm Wire',
              productSku: 'WIR-2.5',
              hsnCode: '8544',
              uom: 'Coils',
              quantity: 2,
              unitPrice: 2500,
              discountPercent: 5,
              taxRate: 18,
              lineSubtotal: 4750,
              lineTax: 855,
              lineTotal: 5605,
            },
          ],
        });

        if (i % 2 === 0) {
          largePayments.push({
            id: `pay-lg-${i}`,
            organizationId: mockOrg.id,
            paymentNumber: `REC-LG-${String(i).padStart(5, '0')}`,
            customerId: `cust-${i % 20}`,
            amount: 5605,
            paymentMethod: 'UPI',
            paymentDate: '2025-06-20',
            createdAt: '2025-06-20T10:00:00Z',
            allocations: [
              {
                id: `alloc-lg-${i}`,
                paymentId: `pay-lg-${i}`,
                invoiceId: `inv-large-${i}`,
                amountAllocated: 5605,
                createdAt: '2025-06-20T10:00:00Z',
              },
            ],
          });
        }
      }

      const memBefore = process.memoryUsage().heapUsed;
      const t0 = performance.now();

      const buffer = await generateSalesReceiptsWorkbook({
        organization: mockOrg,
        criteria: {
          periodType: 'FY',
          periodLabel: 'FY 2025–26',
          startDate: '2025-04-01',
          endDate: '2026-03-31',
          documentType: 'ALL',
          isDemoMode: false,
        },
        invoices: largeInvoices,
        payments: largePayments,
      });

      const t1 = performance.now();
      const memAfter = process.memoryUsage().heapUsed;

      const durationMs = t1 - t0;
      const heapDeltaMb = (memAfter - memBefore) / 1024 / 1024;

      expect(buffer).toBeDefined();
      expect(buffer.byteLength).toBeGreaterThan(50000); // Over 50 KB binary Excel
      expect(durationMs).toBeLessThan(5000); // Must generate in under 5 seconds
      // Heap allocation for 1,000 invoices should remain under 150 MB
      expect(heapDeltaMb).toBeLessThan(150);
    });
  });
});
