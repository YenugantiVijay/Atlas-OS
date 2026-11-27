/** Integer-paise allocation for an explicitly classified supply; not a place-of-supply engine. */
export type GstSupply = 'state' | 'territory' | 'interstate';
export function splitGstPaise(taxPaise: number, supply: GstSupply) {
  if (!Number.isSafeInteger(taxPaise) || taxPaise < 0) throw new Error('GST must be a non-negative safe integer in paise.');
  if (!['state', 'territory', 'interstate'].includes(supply)) throw new Error('Select an explicit GST supply type.');
  const central = supply === 'interstate' ? 0 : Math.floor(taxPaise / 2);
  const regional = supply === 'interstate' ? 0 : taxPaise - central;
  return { cgst: central, sgst: supply === 'state' ? regional : 0, utgst: supply === 'territory' ? regional : 0, igst: supply === 'interstate' ? taxPaise : 0 };
}
/** UTGST territories without a state GST legislature, including other territory. */
export const UTGST_STATE_CODES = new Set(['04', '26', '31', '35', '38', '97']);
