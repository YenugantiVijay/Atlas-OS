import type { Product, Supplier } from '@/types';
import type { GoodsReceiptRecord } from '@/services/goods-receiving.service';
import type { ReceiptWorksheetLine } from './receiving-worksheet';

/**
 * Short-lived, per-tab operator scratchpad. Never posted to Supabase automatically,
 * never shared across users/organizations, and never treated as posted stock.
 * This survives SPA route changes and browser refresh, not logout or tab close.
 */
export interface ReceivingWorkspace {
  receiptId: string;
  supplierId: string;
  invoice: string;
  date: string;
  notes: string;
  rows: ReceiptWorksheetLine[];
  mixedRows: string[];
  savedState: 'NEW' | 'DRAFT';
  dirty: boolean;
  notebook: string;
  showNotebook: boolean;
  updatedAt: number;
}

const PREFIX = 'atlas:receiving:worksheet:v1:';
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 50;

export const receivingWorkspaceKey = (userId: string, orgId: string): string =>
  userId && orgId ? PREFIX + encodeURIComponent(userId) + ':' + encodeURIComponent(orgId) : '';

const getStorage = (): Storage | null => {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; }
  catch { return null; }
};

export function readReceivingWorkspace(userId: string, orgId: string): ReceivingWorkspace | null {
  const key = receivingWorkspaceKey(userId, orgId);
  const storage = getStorage();
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value: ReceivingWorkspace = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !Array.isArray(value.rows) ||
      value.rows.length > MAX_ROWS || typeof value.receiptId !== 'string' ||
      typeof value.updatedAt !== 'number' || Date.now() - value.updatedAt > EXPIRY_MS ||
      !['NEW', 'DRAFT'].includes(value.savedState) ||
      value.rows.some((r) => !r?.product || r.product.organizationId !== orgId ||
        typeof r.product.id !== 'string' || typeof r.packageText !== 'string' ||
        typeof r.looseUnits !== 'string' || typeof r.unitCost !== 'string' ||
        (r.billedUnits !== undefined && typeof r.billedUnits !== 'string') ||
        (r.damagedUnits !== undefined && typeof r.damagedUnits !== 'string'))) {
      storage.removeItem(key);
      return null;
    }
    return value;
  } catch { try { storage.removeItem(key); } catch { /* quota/security */ } return null; }
}

export function saveReceivingWorkspace(userId: string, orgId: string, snapshot: Omit<ReceivingWorkspace, 'updatedAt'>): void {
  const key = receivingWorkspaceKey(userId, orgId);
  const storage = getStorage();
  if (!key || !storage || snapshot.rows.length > MAX_ROWS) return;
  try { storage.setItem(key, JSON.stringify({ ...snapshot, updatedAt: Date.now() })); }
  catch { /* Storage might be unavailable or full. Never block operator input. */ }
}

export function clearReceivingWorkspace(userId: string, orgId: string): void {
  const key = receivingWorkspaceKey(userId, orgId);
  const storage = getStorage();
  if (key && storage) { try { storage.removeItem(key); } catch { /* readonly fallback */ } }
}

/**
 * If a catalog request finishes after an operator navigates away, merge the
 * *confirmed* product into their original worksheet. Never create stock here.
 */
export function appendConfirmedProductToWorkspace(
  userId: string, orgId: string, receiptId: string, product: Product,
): boolean {
  if (product.organizationId !== orgId) return false;
  const current = readReceivingWorkspace(userId, orgId);
  if (!current || current.receiptId !== receiptId ||
      current.savedState === 'DRAFT' && !current.dirty && current.rows.some((x) => x.product.id === product.id)) return false;
  if (current.rows.some((x) => x.product.id === product.id)) return true;
  if (current.rows.length >= MAX_ROWS) return false;
  saveReceivingWorkspace(userId, orgId, {
    ...current,
    rows: [...current.rows, {
      product, packageText: '', looseUnits: '0',
      unitCost: Number(product.purchaseCost ?? 0).toFixed(2),
    }],
    savedState: current.savedState, dirty: true,
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('atlas:receiving:restored', { detail: { userId, orgId, receiptId } }));
  }
  return true;
}

const cachedLists = new Map<string, { at: number; suppliers: Supplier[]; receipts: GoodsReceiptRecord[] }>();
/**
 * Immediately show previously loaded lists on page return, even if their
 * short freshness TTL elapsed. The page revalidates stale data in the background.
 * Retain no cross-user or cross-organization references.
 */
export function readReceivingLists(userId: string, orgId: string, allowStale = false) {
  const key = receivingWorkspaceKey(userId, orgId);
  const value = cachedLists.get(key);
  if (!value) return null;
  const age = Date.now() - value.at;
  return age >= 0 && age < (allowStale ? 15 * 60_000 : 60_000) ? value : null;
}
export function cacheReceivingLists(userId: string, orgId: string, suppliers: Supplier[], receipts: GoodsReceiptRecord[]): void {
  const key = receivingWorkspaceKey(userId, orgId);
  if (key) cachedLists.set(key, { at: Date.now(), suppliers, receipts });
}
export function clearReceivingLists(userId: string, orgId: string): void {
  cachedLists.delete(receivingWorkspaceKey(userId, orgId));
}

/** Preserve the unfinished quick-product form when navigating away. */
export function readReceivingProductForm(userId: string, orgId: string): Record<string, string> | null {
  const storage = getStorage();
  const key = receivingWorkspaceKey(userId, orgId);
  if (!storage || !key) return null;
  try {
    const value = JSON.parse(storage.getItem(key + ':new-product') || 'null');
    if (!value || typeof value !== 'object' || typeof value.updatedAt !== 'number' ||
      Date.now() - value.updatedAt > EXPIRY_MS || typeof value.fields !== 'object') return null;
    return value.fields;
  } catch { return null; }
}

export function saveReceivingProductForm(userId: string, orgId: string, fields: Record<string, string>): void {
  const storage = getStorage(), key = receivingWorkspaceKey(userId, orgId);
  if (!storage || !key) return;
  try { storage.setItem(key + ':new-product', JSON.stringify({ updatedAt: Date.now(), fields })); }
  catch { /* no storage */ }
}

export function clearReceivingProductForm(userId: string, orgId: string): void {
  const storage = getStorage(), key = receivingWorkspaceKey(userId, orgId);
  if (!storage || !key) return;
  try { storage.removeItem(key + ':new-product'); } catch { /* no storage */ }
}

export function clearAllReceivingTabData(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) storage.removeItem(key);
    }
  } catch { /* privacy mode */ }
}
