import { INDUSTRY_TOOLS, type IndustryToolId } from '../../../src/lib/industry-tools';
import { APP_CONFIG } from './releases';

export { INDUSTRY_TOOLS };
export const industryDownloadHref = (id: string) => `/download/${id}/`;

export function industryLaunch(id: IndustryToolId) {
  const configured = APP_CONFIG.webAppUrl.trim();
  const localPreview = import.meta.env.DEV && !configured;
  try {
    const url = new URL(configured || (localPreview ? 'http://127.0.0.1:5173/' : ''));
    const localHttp = import.meta.env.DEV && url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname);
    if ((!localHttp && url.protocol !== 'https:') || url.username || url.password) return undefined;
    url.searchParams.set('tool', id);
    url.hash = '/';
    const shortcut = '[InternetShortcut]\r\nURL=' + url.href + '\r\n';
    return {
      url: url.href,
      shortcut: 'data:application/octet-stream;base64,' + Buffer.from(shortcut).toString('base64'),
      filename: `Atlas-OS-${id}.url`,
      local: localHttp,
    };
  } catch {
    return undefined;
  }
}
