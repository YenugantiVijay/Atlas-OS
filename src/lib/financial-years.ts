/**
 * Atlas OS — Indian Financial Year & Reporting Date Engine
 *
 * Implements statutory Indian Financial Year (April 1 to March 31) date math,
 * month range resolutions, leap-year calculations, and business timezone alignment.
 */

import { DEFAULT_BUSINESS_TIMEZONE, getBusinessDate } from './dates';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  label: string;
}

export interface FinancialYearOption {
  id: string; // e.g. "2025-26"
  label: string; // e.g. "FY 2025–26 (Apr 2025 – Mar 2026)"
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

/**
 * Returns the Indian Financial Year string (e.g. "FY 2025–26") for a given date in business timezone.
 *
 * In India:
 * - April 1, Year N through March 31, Year N+1 belongs to FY N-(N+1).
 *   Example: 2025-04-01 -> FY 2025–26
 *   Example: 2026-03-31 -> FY 2025–26
 *   Example: 2026-04-01 -> FY 2026–27
 */
export function getIndianFinancialYear(
  date?: string | Date | null,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE
): string {
  const dateStr = getBusinessDate(date, timezone);
  const [yearStr, monthStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (month >= 4) {
    const nextYearShort = String((year + 1) % 100).padStart(2, '0');
    return `FY ${year}–${nextYearShort}`;
  } else {
    const prevYear = year - 1;
    const currentYearShort = String(year % 100).padStart(2, '0');
    return `FY ${prevYear}–${currentYearShort}`;
  }
}

/**
 * Parses a financial year identifier (e.g. "2025-26" or "FY 2025-26" or "FY 2025–26")
 * into its exact statutory start (Apr 1) and end (Mar 31) calendar dates.
 */
export function getFinancialYearRange(fyInput: string): DateRange {
  // Normalize dashes and prefix
  const clean = fyInput
    .replace(/^FY\s*/i, '')
    .replace(/[–—]/g, '-')
    .trim();

  const [startYearStr] = clean.split('-');
  const startYear = parseInt(startYearStr, 10);

  if (isNaN(startYear) || startYear < 2000 || startYear > 2100) {
    throw new Error(`Invalid financial year format: '${fyInput}'. Expected format 'YYYY-YY' (e.g. '2025-26').`);
  }

  const endYear = startYear + 1;
  const nextYearShort = String(endYear % 100).padStart(2, '0');

  return {
    startDate: `${startYear}-04-01`,
    endDate: `${endYear}-03-31`,
    label: `FY ${startYear}–${nextYearShort}`,
  };
}

/**
 * Generates an array of available Indian Financial Years centered around a reference date.
 * Default returns 5 financial years: current FY and 4 preceding FYs.
 */
export function getAvailableFinancialYears(
  count: number = 5,
  referenceDate?: string | Date | null,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE
): FinancialYearOption[] {
  const currentDateStr = getBusinessDate(referenceDate, timezone);
  const [yearStr, monthStr] = currentDateStr.split('-');
  const currentYear = parseInt(yearStr, 10);
  const currentMonth = parseInt(monthStr, 10);

  // Determine current FY start year
  const currentFyStartYear = currentMonth >= 4 ? currentYear : currentYear - 1;

  const results: FinancialYearOption[] = [];

  for (let i = 0; i < count; i++) {
    const startYear = currentFyStartYear - i;
    const endYear = startYear + 1;
    const endYearShort = String(endYear % 100).padStart(2, '0');
    const id = `${startYear}-${endYearShort}`;
    const isCurrent = i === 0;

    results.push({
      id,
      label: `FY ${startYear}–${endYearShort}${isCurrent ? ' (Current)' : ''}`,
      startDate: `${startYear}-04-01`,
      endDate: `${endYear}-03-31`,
      isCurrent,
    });
  }

  return results;
}

/**
 * Resolves a calendar month string "YYYY-MM" to its exact start and end dates.
 * Properly calculates the last day of month, including leap year February 29th.
 */
export function getMonthDateRange(yearMonth: string): DateRange {
  const parts = yearMonth.trim().split('-');
  if (parts.length !== 2) {
    throw new Error(`Invalid month format: '${yearMonth}'. Expected 'YYYY-MM'.`);
  }

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month values in '${yearMonth}'. Month must be between 01 and 12.`);
  }

  // Day 0 of month + 1 in UTC gives the exact last day of target month (leap-year safe)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthPadded = String(month).padStart(2, '0');
  const lastDayPadded = String(lastDay).padStart(2, '0');

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return {
    startDate: `${year}-${monthPadded}-01`,
    endDate: `${year}-${monthPadded}-${lastDayPadded}`,
    label: `${monthNames[month - 1]} ${year}`,
  };
}

/**
 * Resolves a single calendar day "YYYY-MM-DD" to a single-day DateRange.
 */
export function getSingleDayDateRange(dayStr: string): DateRange {
  const clean = dayStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    throw new Error(`Invalid day format: '${dayStr}'. Expected 'YYYY-MM-DD'.`);
  }

  return {
    startDate: clean,
    endDate: clean,
    label: clean,
  };
}

/**
 * Validates that start and end dates form a consistent calendar window.
 */
export function isValidDateRange(startDate?: string | null, endDate?: string | null): boolean {
  if (!startDate || !endDate) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return false;
  }
  return startDate <= endDate;
}
