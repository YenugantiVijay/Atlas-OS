import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const root = path.resolve('dist');
const screenshots = path.resolve('test-results/pwa');
await mkdir(screenshots, { recursive: true });
let update = false;
const types = {'.html':'text/html','.js':'application/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.css':'text/css'};
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if(url.pathname==='/api/probe') {res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end('{"private":true}'); return;}
  const requested = path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(requested!==root && !requested.startsWith(root+path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const file = (await stat(requested)).isDirectory() ? path.join(requested,'index.html') : requested;
    let body = await readFile(file);
    if(file.endsWith('sw.js') && update) body = Buffer.concat([body,Buffer.from('\nself.__atlasUpdateProof = 2;\n')]);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  } catch {res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({serviceWorkers:'allow'});
  let page = await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/install.html');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cdp = await context.newCDPSession(page);
  const installability = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installability.installabilityErrors, []);
  const manifest=await (await page.request.get(origin+'/manifest.webmanifest')).json();
  assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'/');
  for(const icon of manifest.icons) {const response=await page.request.get(origin+icon.src);assert.equal(response.status(),200); assert.equal(response.headers()['content-type'],'image/png');}
  await page.getByRole('button',{name:'Install Atlas OS',exact:true}).click();
  assert.match(await page.locator('#install-status').textContent(),/menu|install/i);
  const packageVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
  assert.equal(await page.locator('#version').textContent(), packageVersion);
  await page.evaluate(async () => {await fetch('/api/probe');});
  let cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request=>new URL(request.url).pathname)))).flat());
  assert.ok(cached.includes('/offline.html'));assert.ok(!cached.some(url=>url.includes('/api/')||url==='/'));
  await context.setOffline(true);
  await page.goto(origin+'/private-business-route');
  await page.getByRole('heading',{name:'Connect to continue'}).waitFor();
  await context.setOffline(false);
  await page.waitForFunction(() => document.querySelector('#connection-status')?.textContent.includes('reports a connection'));
  await page.goto(origin+'/install.html');
  // New worker remains waiting until every app client is closed.
  update=true;
  await page.evaluate(async () => {const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
  assert.equal(await page.title(),'Installation Centre — Atlas OS');
  await page.close();
  page=await context.newPage();await page.goto(origin+'/install.html');
  await page.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration())?.waiting);
  // Browser may retain both worker handles briefly; assert new active code through all handles.
  const activated = await Promise.all(context.serviceWorkers().map(w=>w.evaluate(() => self.__atlasUpdateProof).catch(()=>undefined)));
  assert.ok(activated.includes(2));
  await page.screenshot({path:path.join(screenshots, 'install-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(screenshots, 'install-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('PASS: production manifest/icons, real service worker activation, private-response cache exclusion, offline navigation, reconnect status, deferred update activation, responsive layout, and no page errors.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
