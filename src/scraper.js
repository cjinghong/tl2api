import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = path.resolve(__dirname, '..', 'browser-data');

export async function scrapeTimeline({ count = 20, filterAds = true, headless = true } = {}) {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const isLoggedOut = async () => {
      const url = page.url();
      if (url.includes('login') || url.includes('/i/flow/login') || url.includes('/i/flow/signup')) return true;
      if (!url.includes('/home')) return true;
      const hasLoginCta = await page.evaluate(() => {
        const txt = document.body ? document.body.innerText || '' : '';
        return /Sign in to X/i.test(txt) || /New to X\?/i.test(txt) || !!document.querySelector('a[href="/login"], a[data-testid="loginButton"]');
      }).catch(() => false);
      return hasLoginCta;
    };

    try {
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
    } catch (err) {
      if (await isLoggedOut()) {
        throw new Error('Not logged in. Run: npm run login');
      }
      throw err;
    }

    if (await isLoggedOut()) {
      throw new Error('Not logged in. Run: npm run login');
    }

    const collected = new Map();
    let scrolls = 0;
    const MAX_SCROLLS = 30;

    const targetReached = () => {
      if (filterAds) {
        let n = 0;
        for (const t of collected.values()) if (!t.isPromoted) n++;
        return n >= count;
      }
      return collected.size >= count;
    };

    while (!targetReached() && scrolls < MAX_SCROLLS) {
      const batch = await page.evaluate(extractAllTweets);
      for (const t of batch) {
        if (t && t.id && !collected.has(t.id)) collected.set(t.id, t);
      }
      if (targetReached()) break;
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
      await page.waitForTimeout(1500);
      scrolls++;
    }

    let results = Array.from(collected.values());
    if (filterAds) results = results.filter((t) => !t.isPromoted);
    return results.slice(0, count);
  } finally {
    await context.close();
  }
}

function extractAllTweets() {
  const parseNum = (s) => {
    if (!s) return 0;
    const str = String(s).trim().replace(/,/g, '');
    const m = str.match(/([\d.]+)\s*([KMB]?)/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    if (isNaN(n)) return 0;
    const suf = (m[2] || '').toUpperCase();
    if (suf === 'K') return Math.round(n * 1000);
    if (suf === 'M') return Math.round(n * 1000000);
    if (suf === 'B') return Math.round(n * 1000000000);
    return Math.round(n);
  };

  const safe = (fn, dflt) => {
    try {
      const v = fn();
      return v === undefined || v === null ? dflt : v;
    } catch {
      return dflt;
    }
  };

  const parseMetricFromAria = (el, keyword) => {
    if (!el) return 0;
    const aria = el.getAttribute('aria-label') || '';
    const re = new RegExp(`([\\d.,]+[KMB]?)\\s+${keyword}`, 'i');
    const m = aria.match(re);
    if (m) return parseNum(m[1]);
    const just = aria.match(/^([\d.,]+[KMB]?)/);
    return just ? parseNum(just[1]) : 0;
  };

  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  const out = [];

  for (const art of articles) {
    const tweet = {
      id: null,
      url: null,
      author: { handle: null, displayName: null, avatarUrl: null, verified: false },
      text: '',
      timestamp: null,
      metrics: { replies: 0, retweets: 0, likes: 0, views: 0, bookmarks: 0 },
      media: [],
      isPromoted: false,
      isRetweet: false,
      retweetedBy: null,
      quotedTweet: null,
      lang: null,
    };

    safe(() => {
      const timeEl = art.querySelector('time[datetime]');
      if (timeEl) {
        tweet.timestamp = timeEl.getAttribute('datetime');
        const a = timeEl.closest('a[href*="/status/"]');
        if (a) {
          const href = a.getAttribute('href');
          const m = href.match(/\/([^/]+)\/status\/(\d+)/);
          if (m) {
            tweet.id = m[2];
            tweet.url = 'https://x.com' + href.split('?')[0];
          }
        }
      }
    });

    if (!tweet.id) {
      safe(() => {
        const a = art.querySelector('a[href*="/status/"]');
        if (a) {
          const href = a.getAttribute('href');
          const m = href.match(/\/([^/]+)\/status\/(\d+)/);
          if (m) {
            tweet.id = m[2];
            tweet.url = 'https://x.com' + href.split('?')[0];
          }
        }
      });
    }

    safe(() => {
      const userBlock = art.querySelector('[data-testid="User-Name"]');
      if (userBlock) {
        const links = userBlock.querySelectorAll('a[href^="/"]');
        for (const l of links) {
          const h = l.getAttribute('href');
          if (h && /^\/[^/]+$/.test(h)) {
            tweet.author.handle = '@' + h.slice(1);
            break;
          }
        }
        const spans = userBlock.querySelectorAll('span');
        for (const sp of spans) {
          const txt = (sp.textContent || '').trim();
          if (txt && !txt.startsWith('@') && !txt.startsWith('·')) {
            tweet.author.displayName = txt;
            break;
          }
        }
        tweet.author.verified = !!userBlock.querySelector('svg[data-testid="icon-verified"]');
      }
      const img = art.querySelector('img[src*="profile_images"]');
      if (img) tweet.author.avatarUrl = img.getAttribute('src');
    });

    safe(() => {
      const textEl = art.querySelector('div[data-testid="tweetText"]');
      if (textEl) {
        tweet.text = textEl.innerText || textEl.textContent || '';
        tweet.lang = textEl.getAttribute('lang');
      }
    });

    safe(() => {
      const replyBtn = art.querySelector('[data-testid="reply"]');
      const rtBtn = art.querySelector('[data-testid="retweet"]') || art.querySelector('[data-testid="unretweet"]');
      const likeBtn = art.querySelector('[data-testid="like"]') || art.querySelector('[data-testid="unlike"]');
      const bookmarkBtn = art.querySelector('[data-testid="bookmark"]') || art.querySelector('[data-testid="removeBookmark"]');
      const viewLink = art.querySelector('a[href*="/analytics"]');

      tweet.metrics.replies = parseMetricFromAria(replyBtn, 'repl');
      tweet.metrics.retweets = parseMetricFromAria(rtBtn, 'repost') || parseMetricFromAria(rtBtn, 'retweet');
      tweet.metrics.likes = parseMetricFromAria(likeBtn, 'like');
      tweet.metrics.bookmarks = parseMetricFromAria(bookmarkBtn, 'bookmark');
      tweet.metrics.views = parseMetricFromAria(viewLink, 'view');

      const groupAria = (art.querySelector('[role="group"]') || {}).getAttribute?.('aria-label') || '';
      if (groupAria) {
        const pairs = [
          ['replies', /([\d.,]+[KMB]?)\s+repl/i],
          ['retweets', /([\d.,]+[KMB]?)\s+repost/i],
          ['likes', /([\d.,]+[KMB]?)\s+like/i],
          ['views', /([\d.,]+[KMB]?)\s+view/i],
          ['bookmarks', /([\d.,]+[KMB]?)\s+bookmark/i],
        ];
        for (const [k, re] of pairs) {
          if (!tweet.metrics[k]) {
            const m = groupAria.match(re);
            if (m) tweet.metrics[k] = parseNum(m[1]);
          }
        }
      }
    });

    safe(() => {
      for (const img of art.querySelectorAll('img[src*="pbs.twimg.com/media/"]')) {
        tweet.media.push({ type: 'photo', url: img.getAttribute('src') });
      }
      const video = art.querySelector('video');
      const videoWrap = art.querySelector('[data-testid="videoPlayer"]');
      if (video) {
        const isGif = (video.getAttribute('poster') || '').includes('tweet_video_thumb');
        tweet.media.push({ type: isGif ? 'gif' : 'video', url: video.getAttribute('src') || video.getAttribute('poster') || null });
      } else if (videoWrap) {
        const posterImg = videoWrap.querySelector('img');
        tweet.media.push({ type: 'video', url: posterImg ? posterImg.getAttribute('src') : null });
      }
    });

    safe(() => {
      const placement = art.querySelector('[data-testid="placementTracking"]');
      if (placement && /\bAd\b/.test(placement.textContent || '')) tweet.isPromoted = true;
      if (!tweet.isPromoted) {
        for (const sp of art.querySelectorAll('span')) {
          const t = (sp.textContent || '').trim();
          if (t === 'Ad' || t === 'Promoted') { tweet.isPromoted = true; break; }
        }
      }
    });

    safe(() => {
      const social = art.querySelector('[data-testid="socialContext"]');
      if (social) {
        const txt = (social.textContent || '').toLowerCase();
        if (txt.includes('reposted') || txt.includes('retweeted')) {
          tweet.isRetweet = true;
          tweet.retweetedBy = (social.textContent || '').replace(/reposted|retweeted/i, '').trim();
        }
      }
    });

    safe(() => {
      const inner = art.querySelector('div[role="link"][tabindex="0"]');
      if (!inner) return;
      const qt = { author: { handle: null, displayName: null }, text: '', url: null };
      const qHref = inner.querySelector('a[href*="/status/"]')?.getAttribute('href');
      if (qHref) {
        const m = qHref.match(/\/([^/]+)\/status\/(\d+)/);
        if (m) { qt.author.handle = '@' + m[1]; qt.url = 'https://x.com' + qHref.split('?')[0]; }
      }
      const qUser = inner.querySelector('[data-testid="User-Name"] span');
      if (qUser) qt.author.displayName = (qUser.textContent || '').trim();
      const qText = inner.querySelector('div[data-testid="tweetText"]');
      if (qText) qt.text = qText.innerText || qText.textContent || '';
      if (qt.url || qt.text) tweet.quotedTweet = qt;
    });

    out.push(tweet);
  }

  return out;
}
