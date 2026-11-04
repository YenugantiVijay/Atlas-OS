import { useContext, useState } from 'react';
import { useSearchParams as useRRSearchParams, URLSearchParamsInit } from 'react-router-dom';
import { UNSAFE_LocationContext } from 'react-router';

const DUMMY_SEARCH_PARAMS = new URLSearchParams();

export type SetURLSearchParams = (
  nextInit?: URLSearchParamsInit | ((prev: URLSearchParams) => URLSearchParamsInit),
  navigateOpts?: { replace?: boolean; state?: any }
) => void;

/**
 * A router-safe wrapper around useSearchParams that does not throw an invariant error
 * when rendered in unit tests or environments without an enclosing <Router>.
 */
export function useSafeSearchParams(defaultInit?: URLSearchParamsInit): [URLSearchParams, SetURLSearchParams] {
  const inRouter = useContext(UNSAFE_LocationContext) != null;

  if (!inRouter) {
    // Safe fallback for standalone unit tests rendered without <MemoryRouter>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [params, setParams] = useState<URLSearchParams>(() => {
      if (defaultInit) {
        return new URLSearchParams(defaultInit as any);
      }
      return DUMMY_SEARCH_PARAMS;
    });

    const setSafeParams: SetURLSearchParams = (next) => {
      setParams((prev) => {
        const nextVal = typeof next === 'function' ? next(prev) : next;
        return new URLSearchParams(nextVal as any);
      });
    };

    return [params, setSafeParams];
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useRRSearchParams(defaultInit);
}
