let installPrompt;
const status = document.getElementById('install-status');
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; if (status) status.textContent = 'Atlas OS is ready to install.'; });
window.addEventListener('appinstalled', () => { installPrompt = undefined; if(status) status.textContent = 'Atlas OS installed. Open it from your app list.'; });
document.getElementById('install')?.addEventListener('click', async () => {
  if (!installPrompt) { status.textContent = 'Use the Chrome or Edge menu instructions below. Atlas OS may already be installed.'; return; }
  const prompt = installPrompt; installPrompt = undefined;
  try { await prompt.prompt(); const choice = await prompt.userChoice; status.textContent = choice.outcome === 'accepted' ? 'Installation accepted.' : 'Installation dismissed. You can continue online.'; }
  catch { status.textContent = 'Installation unavailable. Use the browser menu instructions below.'; }
});
const connection = () => { const target = document.getElementById('connection-status'); if(target) target.textContent = navigator.onLine ? 'Your device reports a connection. Retry Atlas OS when ready.' : 'Waiting for a connection.'; };
window.addEventListener('online', connection); window.addEventListener('offline', connection); connection();
fetch('/version.json', {cache:'no-store'}).then(response => response.ok ? response.json() : Promise.reject()).then(data => { const target=document.getElementById('version'); if(target) target.textContent=data.version; }).catch(() => { const target=document.getElementById('version'); if(target) target.textContent='unavailable offline'; });
if ('serviceWorker' in navigator && window.isSecureContext) fetch('/version.json', {cache:'no-store'}).then(response => response.json()).then(data => { if(typeof data.version === 'string') return navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'}); }).catch(() => undefined);
