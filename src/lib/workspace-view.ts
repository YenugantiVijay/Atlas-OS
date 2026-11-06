/**
 * Atlas OS workspace navigation preferences.
 *
 * Essentials only reduces navigation complexity. It NEVER changes authorization,
 * route access, subscription entitlements, or any business workflow.
 */
export type WorkspaceView = 'essentials' | 'all';

export const ESSENTIAL_WORKSPACE_GROUPS: ReadonlyArray<{
  title: string;
  paths: readonly string[];
}> = [
  {
    title: 'Daily Work',
    paths: ['/', '/orders', '/invoices', '/payments', '/customers', '/products'],
  },
  {
    title: 'Stock & Reports',
    paths: ['/inventory', '/reports/sales-receipts', '/suppliers'],
  },
  {
    title: 'Business Settings',
    paths: ['/settings'],
  },
];

export function getWorkspaceViewStorageKey(
  organizationId: string | undefined,
  userId: string | undefined,
  isDemoMode: boolean
): string {
  const scope = isDemoMode ? 'demo' : 'cloud';
  return [
    'atlas_workspace_view_v1',
    scope,
    encodeURIComponent(userId || 'guest'),
    encodeURIComponent(organizationId || 'no-organization'),
  ].join(':');
}

export function loadWorkspaceView(key: string): WorkspaceView {
  try {
    if (typeof window !== 'undefined' && window.localStorage.getItem(key) === 'all') {
      return 'all';
    }
  } catch {
    // Storage access may be disabled by the browser; use the safe default.
  }
  return 'essentials';
}

export function saveWorkspaceView(key: string, value: WorkspaceView): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Preference is best-effort; navigation still works without local storage.
  }
}
