/** Rate history never mutates inventory cost or product pricing. */
export function parseSupplierRate(input: string): number {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(input.trim())) {
    throw new Error('Enter a nonnegative supplier rate with at most two decimals.');
  }
  const rate = Number(input.trim());
  if (!Number.isFinite(rate) || rate > 9999999999.99) {
    throw new Error('Supplier rate exceeds the maximum supported amount.');
  }
  return rate;
}

export function supplierRateChange(previous: number | null | undefined, next: number): {
  difference: number | null;
  percent: number | null;
  direction: 'increase' | 'decrease' | 'unchanged' | 'unknown';
  significant: boolean;
} {
  if (previous == null || !Number.isFinite(previous) || previous < 0 ||
      !Number.isFinite(next) || next < 0) {
    return { difference: null, percent: null, direction: 'unknown', significant: false };
  }
  const difference = Math.round((next - previous) * 100) / 100;
  const percent = previous > 0 ? (difference / previous) * 100 : null;
  const direction = difference > 0 ? 'increase' : difference < 0 ? 'decrease' : 'unchanged';
  // Advisory visual highlight only; no prediction, notification or auto-approval.
  return { difference, percent, direction, significant: percent !== null && Math.abs(percent) >= 5 };
}
