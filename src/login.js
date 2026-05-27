import { chromium } from 'playwright';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'browser-data');

const context = await chromium.launchPersistentContext(DATA_DIR, {
  headless: false,
  channel: 'chrome',
  viewport: { width: 1280, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
});

await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

let closed = false;
context.on('close', () => {
  if (!closed) {
    closed = true;
    process.exit(0);
  }
});

const pages = context.pages();
const page = pages.length ? pages[0] : await context.newPage();
await page.goto('https://x.com/login');

console.log('\nLog in to X in the browser window.');
console.log('When you see your timeline at x.com/home, press ENTER in this terminal to save the session and close.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('', async () => {
  rl.close();
  closed = true;
  try {
    await context.close();
  } catch {}
  process.exit(0);
});
