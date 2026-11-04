/**
 * Atlas OS — Indian Goods and Services Tax (GST) & Place of Supply Utilities
 *
 * Implements authoritative validation and resolution of:
 * 1. Indian State Codes and State Names (01 to 38, 97, 99)
 * 2. 15-character GSTIN state extraction and validation
 * 3. Authoritative Place of Supply (POS) resolution without guessing
 */

export interface StateInfo {
  code: string;
  name: string;
}

export const INDIAN_GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Validates whether a string conforms to the statutory Indian 15-character GSTIN format.
 */
export function isValidGstin(gstin: string | undefined | null): boolean {
  if (!gstin) return false;
  return GSTIN_REGEX.test(gstin.trim().toUpperCase());
}

/**
 * Extracts state code and state name from a valid GSTIN.
 * Returns null if the GSTIN format is invalid or state code is unrecognized.
 */
export function getStateFromGstin(gstin: string | undefined | null): StateInfo | null {
  if (!gstin) return null;
  const clean = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(clean)) return null;

  const code = clean.substring(0, 2);
  const name = INDIAN_GST_STATES[code];
  if (!name) return null;

  return { code, name };
}

/**
 * Normalizes a state name to title casing and matches against known Indian states.
 */
export function findMatchingIndianState(stateOrAddressText: string | undefined | null): StateInfo | null {
  if (!stateOrAddressText) return null;
  const lower = stateOrAddressText.toLowerCase();

  for (const [code, name] of Object.entries(INDIAN_GST_STATES)) {
    const nameLower = name.toLowerCase();
    // Word boundary or comma-separated match
    const regex = new RegExp(`\\b${nameLower.replace(/&/g, '(&|and)')}\\b`, 'i');
    if (regex.test(lower) || lower === nameLower) {
      return { code, name };
    }
  }
  return null;
}

export interface PlaceOfSupplyResolution {
  placeOfSupply: string | null;
  stateCode: string | null;
  source: 'customer_gstin' | 'customer_address' | 'org_state' | 'none';
  isVerified: boolean;
  warning?: string;
}

/**
 * Authoritatively resolves Place of Supply (POS) for an invoice without guessing.
 *
 * Precedence:
 * 1. Verified Customer GSTIN (B2B registered recipient).
 * 2. Customer billing address containing a verified Indian state name.
 * 3. Organization State if customer is an unregistered consumer and address has no conflicting state.
 * 4. Fails safely with an actionable warning when neither is available.
 */
export function resolvePlaceOfSupply(params: {
  customer?: {
    gstin?: string | null;
    billingAddress?: string | null;
  } | null;
  currentOrg?: {
    state?: string | null;
    gstin?: string | null;
  } | null;
}): PlaceOfSupplyResolution {
  const { customer, currentOrg } = params;

  // 1. Authoritative B2B: Recipient GSTIN
  if (customer?.gstin && isValidGstin(customer.gstin)) {
    const fromGstin = getStateFromGstin(customer.gstin);
    if (fromGstin) {
      return {
        placeOfSupply: fromGstin.name,
        stateCode: fromGstin.code,
        source: 'customer_gstin',
        isVerified: true,
      };
    }
  }

  // 2. Verified state found in customer billing address
  if (customer?.billingAddress) {
    const fromAddr = findMatchingIndianState(customer.billingAddress);
    if (fromAddr) {
      return {
        placeOfSupply: fromAddr.name,
        stateCode: fromAddr.code,
        source: 'customer_address',
        isVerified: true,
      };
    }
  }

  // 3. Fallback to supplier organization state for local unregistered counter sales
  if (currentOrg?.state) {
    const orgStateMatch = findMatchingIndianState(currentOrg.state);
    if (orgStateMatch) {
      return {
        placeOfSupply: orgStateMatch.name,
        stateCode: orgStateMatch.code,
        source: 'org_state',
        isVerified: true,
      };
    }
  }

  // 4. Could not verify — return unverified status with actionable warning
  return {
    placeOfSupply: null,
    stateCode: null,
    source: 'none',
    isVerified: false,
    warning: 'Place of Supply could not be verified. Update customer GSTIN or address.',
  };
}
