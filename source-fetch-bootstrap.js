const { chromium } = require('playwright');

const SOURCE_ORIGIN = 'https://im4car.by';
const SOURCE_HOME = `${SOURCE_ORIGIN}/`;
const ORIGINAL_FETCH = global.fetch;

function isHomeRequest(input) {
  try {
    const url = typeof input === 'string' ? input : input?.url;
    return new URL(url).origin === SOURCE_ORIGIN && new URL(url).pathname === '/';
  } catch {
    return false;
  }
}

async function browserFetch() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36'
  });
  try {
    await page.goto(SOURCE_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    const html = await page.content(), title = await page.title();
    console.log(`[source-fetch] browser fallback: ${html.length} bytes; title="${title}"`);
    if (!html || html.length < 5000) throw new Error(`IM4CAR_BROWSER_SHORT_${html.length}`);
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-source-fetch': 'playwright' } });
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

global.fetch = async function patchedFetch(input, init) {
  if (!isHomeRequest(input)) return ORIGINAL_FETCH(input, init);
  try {
    const response = await ORIGINAL_FETCH(input, init), text = await response.text();
    const looksUsable = response.ok && text.length >= 5000 && /\/cars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text);
    if (looksUsable) {
      console.log(`[source-fetch] direct: ${text.length} bytes`);
      return new Response(text, { status: response.status, headers: response.headers });
    }
    console.warn(`[source-fetch] direct response unusable: status=${response.status}, bytes=${text.length}; using browser fallback`);
  } catch (error) {
    console.warn(`[source-fetch] direct fetch failed: ${error.message}; using browser fallback`);
  }
  return browserFetch();
};

require('./server.js');
