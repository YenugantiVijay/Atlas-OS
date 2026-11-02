import { describe, it, expect } from 'vitest';
import {
  getBusinessDate,
  getBusinessDateOffset,
  isInvoiceOverdue,
  formatDisplayDate,
  DEFAULT_BUSINESS_TIMEZONE,
} from './dates';

describe('Business Date & Timezone Engine (Asia/Kolkata IST)', () => {
  it('correctly maps 1:00 AM IST to the next day when UTC is still previous day', () => {
    // 2026-11-01T20:00:00Z is 2026-11-02 01:30:00 in IST (UTC+5:30)
    const utcTimestamp = '2026-11-01T20:00:00.000Z';
    const naiveUtcDate = new Date(utcTimestamp).toISOString().split('T')[0];
    expect(naiveUtcDate).toBe('2026-11-01'); // Naive UTC is wrong for India

    const businessDate = getBusinessDate(utcTimestamp, DEFAULT_BUSINESS_TIMEZONE);
    expect(businessDate).toBe('2026-11-02'); // Correct IST date
  });

  it('correctly calculates day offsets across month boundaries and leap years', () => {
    // 2024 is a leap year (February has 29 days)
    const feb28 = '2024-02-28';
    expect(getBusinessDateOffset(1, feb28)).toBe('2024-02-29');
    expect(getBusinessDateOffset(2, feb28)).toBe('2024-03-01');

    // Year boundary
    const dec31 = '2025-12-31';
    expect(getBusinessDateOffset(1, dec31)).toBe('2026-01-01');
    expect(getBusinessDateOffset(30, dec31)).toBe('2026-01-30');
  });

  it('accurately evaluates overdue status using calendar date comparison', () => {
    const today = '2026-11-02';
    expect(isInvoiceOverdue('2026-11-01', today)).toBe(true);
    expect(isInvoiceOverdue('2026-11-02', today)).toBe(false); // Due today is NOT overdue
    expect(isInvoiceOverdue('2026-11-03', today)).toBe(false);
    expect(isInvoiceOverdue(null, today)).toBe(false);
  });

  it('formats dates consistently for display in Indian locale', () => {
    const date = '2026-11-02';
    const formatted = formatDisplayDate(date);
    expect(formatted).toMatch(/02\sNov\s2026/);
  });
});
