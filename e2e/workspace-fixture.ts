import { test as base } from '@playwright/test';
import { testStorageEntries } from '../src/test/storage-fixtures';

export { expect } from '@playwright/test';

export const test = base.extend<{ seedWorkspace: void }>({
  seedWorkspace: [async ({ context, baseURL }, use) => {
    if (!baseURL) throw new Error('Workspace fixture requires the app test URL');
    await context.addInitScript(({ origin, entries }) => {
      if (location.origin !== origin || localStorage.getItem('atlas_organizations_v1')) return;
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, { origin: new URL(baseURL).origin, entries: testStorageEntries() });
    await use();
  }, { auto: true }],
});
