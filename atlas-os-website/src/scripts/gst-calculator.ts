type Supply = 'state' | 'territory' | 'interstate';
type Mode = 'add' | 'remove';

function scaledValue(input: string) {
  const value = input.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{0,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.replaceAll(',', '').split('.');
  if (whole.length > 9) return null;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function calculateGst(amount: string, rate: string, mode: Mode, supply: Supply) {
  const paise = scaledValue(amount);
  const basisPoints = scaledValue(rate);
  if (paise === null || basisPoints === null || basisPoints > 10000) return null;

  const denominator = mode === 'remove' ? 10000 + basisPoints : 10000;
  const numerator = paise * basisPoints;
  const tax = Math.floor((numerator + denominator / 2) / denominator);
  const central = supply === 'interstate' ? 0 : Math.floor(tax / 2);
  return {
    base: mode === 'remove' ? paise - tax : paise,
    tax,
    total: mode === 'remove' ? paise : paise + tax,
    central,
    regional: supply === 'interstate' ? 0 : tax - central,
    integrated: supply === 'interstate' ? tax : 0,
  };
}
