import { useContext } from 'react';
import { UNSAFE_LocationContext } from 'react-router';
import { useNavigate as useRRNavigate, NavigateFunction } from 'react-router-dom';

/**
 * A router-safe wrapper around useNavigate that does not throw an invariant error
 * when rendered in unit tests or environments without an enclosing <Router>.
 */
export function useSafeNavigate(): NavigateFunction {
  const inRouter = useContext(UNSAFE_LocationContext) != null;

  if (!inRouter) {
    const dummyNavigate: any = () => {};
    return dummyNavigate;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useRRNavigate();
}
