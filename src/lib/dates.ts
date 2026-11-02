/**
 * Atlas OS — Business Date & Timezone Engine
 *
 * Implements authoritative business date calculations for Indian Standard Time (IST / Asia/Kolkata, UTC+5:30)
 * and merchant-configured business timezones.
 *
 * Prevents midnight displacement vulnerabilities where transactions conducted between
 * 00:00 and 05:30 IST would otherwise receive yesterday's calendar date under naive UTC toISOString() slicing.
 */

export const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns a YYYY-MM-DD calendar date string in the target business timezone.
 *
 * @param date - Date object, ISO string, or undefined (defaults to current wall clock)
 * @param timezone - IANA timezone identifier (defaults to Asia/Kolkata)
 */
export function getBusinessDate(
  date?: Date | string | null,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE
): string {
  const d = date ? (typeof date === 'string' ? new Date(date) : date) : new Date();

  // If date is invalid, fallback to current wall clock
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(validDate);
}

/**
 * Calculates a future or past business date offset by a specified number of calendar days.
 *
 * @param days - Number of days to add (positive) or subtract (negative)
 * @param fromDate - Base date (defaults to today in business timezone)
 * @param timezone - IANA timezone identifier
 */
export function getBusinessDateOffset(
  days: number,
  fromDate?: Date | string | null,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE
): string {
  const baseDateStr = getBusinessDate(fromDate, timezone);
  const [year, month, day] = baseDateStr.split('-').map(Number);

  // Use UTC to perform clean, leap-year and month-end safe day arithmetic
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);

  const resYear = utcDate.getUTCFullYear();
  const resMonth = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const resDay = String(utcDate.getUTCDate()).padStart(2, '0');

  return `${resYear}-${resMonth}-${resDay}`;
}

/**
 * Evaluates whether an invoice or document due date is strictly past due
 * relative to the business calendar date (not UTC clock).
 *
 * @param dueDateStr - YYYY-MM-DD or ISO timestamp
 * @param referenceDate - Comparison date (defaults to today)
 * @param timezone - Target business timezone
 */
export function isInvoiceOverdue(
  dueDateStr?: string | null,
  referenceDate?: Date | string | null,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE
): boolean {
  if (!dueDateStr) return false;
  const due = dueDateStr.slice(0, 10);
  const today = getBusinessDate(referenceDate, timezone);
  return due < today;
}

/**
 * Formats a business date for professional UI display and print presentation (e.g. "02 Nov 2026").
 */
export function formatDisplayDate(
  dateStr?: string | Date | null,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE
): string {
  if (!dateStr) return '—';
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  if (isNaN(d.getTime())) return String(dateStr);

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}
