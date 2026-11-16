/** Read plain, Indian-grouped, or Western-grouped decimals without floating-point parsing. */
export function readDecimalHundredths(input: string): number | null {
  const value = input.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{0,2})?$/.test(value)) return null;

  const [whole, fraction = ''] = value.replaceAll(',', '').split('.');
  if (whole.length > 9) return null;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
