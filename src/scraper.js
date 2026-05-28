// Scrolls and extracts tweets from a page already on x.com/home. The browser
// lifecycle (launch, login check, reuse, teardown) lives in browser.js.
export async function scrapeTimeline({ page, count = 20, filterAds = true } = {}) {
  const collected = new Map();
  let scrolls = 0;
  const MAX_SCROLLS = 30;
  const SCROLL_WAIT_MS = 1500;

  const targetReached = () => {
    if (filterAds) {
      let n = 0;
      for (const t of collected.values()) if (!t.isPromoted) n++;
      return n >= count;
    }
    return collected.size >= count;
  };

  const lastTweetHref = () =>
    page.evaluate(() => {
      const arts = document.querySelectorAll('article[data-testid="tweet"]');
      const last = arts[arts.length - 1];
      if (!last) return null;
      const a = last.querySelector('a[href*="/status/"]');
      return a ? a.getAttribute('href') : null;
    });

  while (!targetReached() && scrolls < MAX_SCROLLS) {
    const batch = await page.evaluate(extractAllTweets);
    for (const t of batch) {
      if (t && t.id && !collected.has(t.id)) collected.set(t.id, t);
    }
    if (targetReached()) break;

    const before = await lastTweetHref();
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));

    // Wait until fresh tweets appear (the last article changes) instead of a
    // fixed sleep, capped at SCROLL_WAIT_MS so end-of-feed still terminates.
    const deadline = Date.now() + SCROLL_WAIT_MS;
    while (Date.now() < deadline) {
      await page.waitForTimeout(150);
      const now = await lastTweetHref();
      if (now && now !== before) break;
    }
    scrolls++;
  }

  let results = Array.from(collected.values());
  if (filterAds) results = results.filter((t) => !t.isPromoted);
  return results.slice(0, count);
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
