import { splitGstPaise } from './gst-components';
import { readDecimalHundredths } from './decimal-input';

type Supply = 'state' | 'territory' | 'interstate';
type Mode = 'add' | 'remove';

export function calculateGst(amount: string, rate: string, mode: Mode, supply: Supply) {
  const paise = readDecimalHundredths(amount);
  const basisPoints = readDecimalHundredths(rate);
  if (paise === null || basisPoints === null || basisPoints > 10000) return null;

  const denominator = mode === 'remove' ? 10000 + basisPoints : 10000;
  const numerator = paise * basisPoints;
  const tax = Math.floor((numerator + denominator / 2) / denominator);
  const components = splitGstPaise(tax, supply);
  return {
    base: mode === 'remove' ? paise - tax : paise,
    tax,
    total: mode === 'remove' ? paise : paise + tax,
    central: components.cgst,
    regional: components.sgst + components.utgst,
    integrated: components.igst,
  };
}
