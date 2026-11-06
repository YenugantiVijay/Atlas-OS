import { beforeEach, describe, expect, it } from 'vitest';
import {
  ESSENTIAL_WORKSPACE_GROUPS,
  getWorkspaceViewStorageKey,
  loadWorkspaceView,
  saveWorkspaceView,
} from './workspace-view';

describe('Atlas OS workspace navigation preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts in Essentials with the core business workflow available', () => {
    const key = getWorkspaceViewStorageKey('org-one', 'user-one', false);
    expect(loadWorkspaceView(key)).toBe('essentials');

    const paths = ESSENTIAL_WORKSPACE_GROUPS.flatMap((group) => group.paths);
    expect(paths).toEqual(expect.arrayContaining([
      '/', '/products', '/inventory', '/customers', '/orders', '/invoices',
      '/payments', '/reports/sales-receipts', '/settings',
    ]));
    expect(paths).not.toContain('/ai');
    expect(paths).not.toContain('/audit');
  });

  it('preserves All Tools per user and per organization', () => {
    const key = getWorkspaceViewStorageKey('org-one', 'user-one', false);
    const anotherOrg = getWorkspaceViewStorageKey('org-two', 'user-one', false);
    const anotherUser = getWorkspaceViewStorageKey('org-one', 'user-two', false);
    const demoKey = getWorkspaceViewStorageKey('org-one', 'user-one', true);

    saveWorkspaceView(key, 'all');
    expect(loadWorkspaceView(key)).toBe('all');
    expect(loadWorkspaceView(anotherOrg)).toBe('essentials');
    expect(loadWorkspaceView(anotherUser)).toBe('essentials');
    expect(loadWorkspaceView(demoKey)).toBe('essentials');
  });

  it('ignores unexpected stored values and defaults safely', () => {
    const key = getWorkspaceViewStorageKey('org-one', 'user-one', false);
    window.localStorage.setItem(key, 'admin:unlocked');
    expect(loadWorkspaceView(key)).toBe('essentials');
  });
});
