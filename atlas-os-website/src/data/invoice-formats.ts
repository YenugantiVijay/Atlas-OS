import catalogue from './invoice-formats.json';

export interface InvoiceFormat {
  id: string;
  name: string;
  category: string;
  description: string;
  fields: [label: string, description: string][];
  lines: [product: string, quantity: number, unit: string, rate: number, illustrativeTaxRate: number][];
}

export const INVOICE_FORMATS = catalogue as InvoiceFormat[];
