import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = path.resolve(__dirname, '..', 'browser-data');

const IDLE_MS = 30 * 60 * 1000;

const HEADLESS = (() => {
  const v = String(process.env.HEADLESS ?? 'true').toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no');
})();

let context = null;
let page = null;
let idleTimer = null;

async function launch() {
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // Only clear refs if they still point at this context, so a late 'close'
  // event from an old context cannot wipe out a freshly relaunched one.
  ctx.on('close', () => {
    if (context === ctx) {
      context = null;
      page = null;
    }
  });

  context = ctx;
  page = ctx.pages()[0] || (await ctx.newPage());
}

function isAlive() {
  return !!(context && page && !page.isClosed());
}

async function isLoggedOut(p) {
  const url = p.url();
  if (url.includes('login') || url.includes('/i/flow/login') || url.includes('/i/flow/signup')) return true;
  if (!url.includes('/home')) return true;
  const hasLoginCta = await p
    .evaluate(() => {
      const txt = document.body ? document.body.innerText || '' : '';
      return /Sign in to X/i.test(txt) || /New to X\?/i.test(txt) || !!document.querySelector('a[href="/login"], a[data-testid="loginButton"]');
    })
    .catch(() => false);
  return hasLoginCta;
}

async function loadHome(warm) {
  if (warm) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  } else {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  try {
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
  } catch (err) {
    if (await isLoggedOut(page)) throw new Error('Not logged in. Run: npm run login');
    throw err;
  }

  if (await isLoggedOut(page)) throw new Error('Not logged in. Run: npm run login');
}

// Returns a page guaranteed to be on a freshly-loaded x.com/home with tweets
// present, reusing the warm browser when possible. Throws "Not logged in" if
// the saved session has expired.
export async function getFreshTimeline() {
  cancelIdleTimer();

  const warm = isAlive();
  if (!warm) {
    console.log('browser: cold start');
    await launch();
  } else {
    console.log('browser: warm reuse');
  }

  try {
    await loadHome(warm);
  } catch (err) {
    // If a warm page died mid-flight (crash / external close), relaunch once.
    if (warm && !isAlive()) {
      console.log('browser: warm page died, relaunching');
      await launch();
      await loadHome(false);
    } else {
      throw err;
    }
  }

  return page;
}

export function armIdleTimer() {
  cancelIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    console.log('browser: idle shutdown after 30m');
    shutdown().catch(() => {});
  }, IDLE_MS);
  if (idleTimer.unref) idleTimer.unref();
}

function cancelIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

export async function shutdown() {
  cancelIdleTimer();
  const c = context;
  context = null;
  page = null;
  if (c) {
    try {
      await c.close();
    } catch {}
  }
}
