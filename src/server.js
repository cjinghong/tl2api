#!/usr/bin/env node
import express from 'express';
import { scrapeTimeline } from './scraper.js';
import { getFreshTimeline, armIdleTimer, shutdown } from './browser.js';

const app = express();
const port = process.env.PORT || 3000;

let scraping = false;

function parseBool(v, def) {
  if (v === undefined) return def;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return null;
}

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ts = new Date().toISOString();
    const dur = Date.now() - start;
    console.log(`${ts} ${req.method} ${req.path} ${JSON.stringify(req.query)} ${res.statusCode} ${dur}ms`);
  });
  next();
});

app.get('/', (req, res) => {
  res.json({
    endpoints: ['GET /tweets', 'GET /health', 'GET /'],
    example: `http://localhost:${port}/tweets?count=20&filterAds=true`,
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/tweets', async (req, res) => {
  const rawCount = req.query.count;
  let count = 20;
  if (rawCount !== undefined) {
    const n = Number(rawCount);
    if (!Number.isInteger(n)) {
      return res.status(400).json({ error: 'count must be an integer' });
    }
    count = Math.min(200, Math.max(1, n));
  }

  const filterAds = parseBool(req.query.filterAds, true);
  if (filterAds === null) {
    return res.status(400).json({ error: 'filterAds must be boolean' });
  }

  if (scraping) {
    return res.status(429).json({ error: 'Scrape in progress, try again shortly' });
  }
  scraping = true;
  try {
    const page = await getFreshTimeline();
    const tweets = await scrapeTimeline({ page, count, filterAds });
    res.json({ count: tweets.length, requestedCount: count, filterAds, tweets });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg.includes('Not logged in')) {
      return res.status(401).json({ error: 'Not logged in. Run: npm run login' });
    }
    res.status(500).json({ error: msg });
  } finally {
    scraping = false;
    armIdleTimer();
  }
});

const server = app.listen(port, () => {
  console.log(`tl2api listening on http://localhost:${port}`);
  console.log(`Try: http://localhost:${port}/tweets?count=20`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`\n${sig} received, shutting down`);
    server.close();
    await shutdown();
    process.exit(0);
  });
}
