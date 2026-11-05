import { describe, it, expect } from 'vitest';
import {
  getIndianFinancialYear,
  getFinancialYearRange,
  getAvailableFinancialYears,
  getMonthDateRange,
  getSingleDayDateRange,
  isValidDateRange,
} from './financial-years';

describe('Indian Financial Year & Reporting Date Engine', () => {
  describe('getIndianFinancialYear', () => {
    it('correctly attributes April 1st to the new Financial Year', () => {
      expect(getIndianFinancialYear('2025-04-01')).toBe('FY 2025–26');
      expect(getIndianFinancialYear('2026-04-01')).toBe('FY 2026–27');
    });

    it('correctly attributes March 31st to the closing Financial Year', () => {
      expect(getIndianFinancialYear('2026-03-31')).toBe('FY 2025–26');
      expect(getIndianFinancialYear('2025-03-31')).toBe('FY 2024–25');
    });

    it('correctly handles mid-year dates (August, November, January)', () => {
      expect(getIndianFinancialYear('2025-08-15')).toBe('FY 2025–26');
      expect(getIndianFinancialYear('2025-11-05')).toBe('FY 2025–26');
      expect(getIndianFinancialYear('2026-01-26')).toBe('FY 2025–26');
    });

    it('correctly handles leap year leap day (February 29, 2024)', () => {
      expect(getIndianFinancialYear('2024-02-29')).toBe('FY 2023–24');
    });

    it('handles Date objects and timezone preservation', () => {
      // 2025-03-31 20:00:00 UTC is 2025-04-01 01:30:00 IST (+5:30)
      const date = new Date('2025-03-31T20:00:00Z');
      expect(getIndianFinancialYear(date, 'Asia/Kolkata')).toBe('FY 2025–26');
    });
  });

  describe('getFinancialYearRange', () => {
    it('resolves standard FY string to exact April 1 - March 31 dates', () => {
      const range = getFinancialYearRange('2025-26');
      expect(range.startDate).toBe('2025-04-01');
      expect(range.endDate).toBe('2026-03-31');
      expect(range.label).toBe('FY 2025–26');
    });

    it('supports FY prefix and en-dash or em-dash', () => {
      const r1 = getFinancialYearRange('FY 2024-25');
      expect(r1.startDate).toBe('2024-04-01');
      expect(r1.endDate).toBe('2025-03-31');

      const r2 = getFinancialYearRange('FY 2023–24');
      expect(r2.startDate).toBe('2023-04-01');
      expect(r2.endDate).toBe('2024-03-31');
    });

    it('throws descriptive error on invalid FY format', () => {
      expect(() => getFinancialYearRange('invalid')).toThrow(/Invalid financial year format/);
      expect(() => getFinancialYearRange('1990-91')).toThrow(/Invalid financial year format/);
    });
  });

  describe('getAvailableFinancialYears', () => {
    it('returns requested count of financial years centered on reference date', () => {
      const fys = getAvailableFinancialYears(4, '2025-11-10');
      expect(fys).toHaveLength(4);

      expect(fys[0].id).toBe('2025-26');
      expect(fys[0].isCurrent).toBe(true);
      expect(fys[0].startDate).toBe('2025-04-01');
      expect(fys[0].endDate).toBe('2026-03-31');

      expect(fys[1].id).toBe('2024-25');
      expect(fys[1].isCurrent).toBe(false);

      expect(fys[2].id).toBe('2023-24');
      expect(fys[3].id).toBe('2022-23');
    });

    it('correctly determines current FY when in Q4 (January - March)', () => {
      const fys = getAvailableFinancialYears(3, '2026-02-15');
      expect(fys[0].id).toBe('2025-26');
      expect(fys[0].isCurrent).toBe(true);
      expect(fys[1].id).toBe('2024-25');
    });
  });

  describe('getMonthDateRange', () => {
    it('resolves 31-day months (January, May, July, etc.)', () => {
      const jan = getMonthDateRange('2025-01');
      expect(jan.startDate).toBe('2025-01-01');
      expect(jan.endDate).toBe('2025-01-31');
      expect(jan.label).toBe('January 2025');

      const may = getMonthDateRange('2025-05');
      expect(may.startDate).toBe('2025-05-01');
      expect(may.endDate).toBe('2025-05-31');
    });

    it('resolves 30-day months (April, June, September, November)', () => {
      const apr = getMonthDateRange('2025-04');
      expect(apr.startDate).toBe('2025-04-01');
      expect(apr.endDate).toBe('2025-04-30');

      const nov = getMonthDateRange('2025-11');
      expect(nov.startDate).toBe('2025-11-01');
      expect(nov.endDate).toBe('2025-11-30');
    });

    it('correctly calculates leap year February 29th', () => {
      const leapFeb = getMonthDateRange('2024-02');
      expect(leapFeb.startDate).toBe('2024-02-01');
      expect(leapFeb.endDate).toBe('2024-02-29');

      const nonLeapFeb = getMonthDateRange('2025-02');
      expect(nonLeapFeb.startDate).toBe('2025-02-01');
      expect(nonLeapFeb.endDate).toBe('2025-02-28');
    });

    it('throws on invalid month strings', () => {
      expect(() => getMonthDateRange('2025-13')).toThrow(/Invalid month values/);
      expect(() => getMonthDateRange('invalid')).toThrow(/Invalid month format/);
    });
  });

  describe('getSingleDayDateRange', () => {
    it('returns identical start and end dates', () => {
      const day = getSingleDayDateRange('2026-03-31');
      expect(day.startDate).toBe('2026-03-31');
      expect(day.endDate).toBe('2026-03-31');
      expect(day.label).toBe('2026-03-31');
    });

    it('throws on invalid date string format', () => {
      expect(() => getSingleDayDateRange('31-03-2026')).toThrow(/Invalid day format/);
    });
  });

  describe('isValidDateRange', () => {
    it('validates start and end dates', () => {
      expect(isValidDateRange('2025-04-01', '2026-03-31')).toBe(true);
      expect(isValidDateRange('2025-04-01', '2025-04-01')).toBe(true);
      expect(isValidDateRange('2026-03-31', '2025-04-01')).toBe(false);
      expect(isValidDateRange('invalid', '2025-04-01')).toBe(false);
      expect(isValidDateRange(null, undefined)).toBe(false);
    });
  });
});
