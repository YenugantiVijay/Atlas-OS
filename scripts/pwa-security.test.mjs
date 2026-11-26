import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function harness() {
  const handlers = {};
  const cached = [];
  const fallback = { offline: true };
  const sandbox = {
    URL,
    self: { location: { origin: 'https://atlas.test' }, clients: { claim: async () => {} }, addEventListener: (name, handler) => { handlers[name] = handler; } },
    caches: { open: async () => ({addAll: async files => cached.push(...files)}), match: async () => fallback, keys: async () => ['unrelated-cache', 'atlas-public-pwa-old'], delete: async key => { cached.push('deleted:' + key); } },
    fetch: async () => { throw new Error('offline'); },
  };
  vm.runInNewContext(worker, sandbox);
  const request = (url, options = {}) => {
    let promise;
    handlers.fetch({ request: {url,method:'GET',mode:'cors',...options}, respondWith: response => { promise = response; } });
    return promise;
  };
  return { handlers, cached, request, fallback };
}
test('only approved public resources are precached', async () => {
  const h = harness();
  let pending;
  h.handlers.install({waitUntil: promise => { pending = promise; }});
  await pending;
  assert.ok(h.cached.includes('/offline.html'));
  assert.ok(!h.cached.includes('/'));
  assert.ok(h.cached.every(name => !/api|owner|token|invoice|payment/.test(name)));
});
test('private APIs, writes, external requests, and asset-like API paths are not intercepted', () => {
  const h = harness();
  for (const url of ['https://atlas.test/api/invoices','https://atlas.test/rest/v1/payments','https://atlas.test/api/private.js','https://project.supabase.co/rest/v1/invoices','https://atlas.test/offline.html?token=private']) assert.equal(h.request(url), undefined);
  assert.equal(h.request('https://atlas.test/offline.html',{method:'POST'}), undefined);
});
test('navigation failures show public fallback, never a cached business page', async () => {
  const h = harness();
  assert.equal(await h.request('https://atlas.test/owner/',{mode:'navigate'}), h.fallback);
  assert.equal(await h.request('https://atlas.test/',{mode:'navigate'}), h.fallback);
});
test('activation removes only outdated Atlas public caches', async () => {
  const h = harness(); let pending;
  h.handlers.activate({waitUntil: promise => {pending = promise;}}); await pending;
  assert.deepEqual(h.cached, ['deleted:atlas-public-pwa-old']);
});
test('worker does not force an update or reload', () => {
  const h = harness();
  assert.equal(h.handlers.message, undefined);
  assert.doesNotMatch(worker, /self\.skipWaiting\s*\(/);
});
