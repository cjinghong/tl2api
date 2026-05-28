# tl2api

Local API that retrieves your X (Twitter) home timeline **without the X API**. It drives a real logged-in browser session, scrolls your timeline, and returns tweets as JSON with full metadata. No API keys, no developer account, no rate-limit tiers.

## How it works

- **Playwright + real Chrome** loads your logged-in X session from a persistent profile (`browser-data/`).
- A one-time `npm run login` saves the session; after that the scraper reuses it headlessly.
- `GET /tweets` scrolls `x.com/home`, extracts each tweet from the DOM, and returns structured JSON.
- **The browser stays warm** between requests: the first call cold-starts Chrome, later calls just reload the timeline (much faster). After 30 minutes idle, Chrome shuts down and the next call cold-starts again.

## Setup

Install from npm — gives you the `tl2api`, `tl2api-login`, and `tl2api-mcp` commands:

```bash
npm i -g tl2api
tl2api-login    # one-time: log into X in the browser, then press ENTER
tl2api          # serves http://localhost:3000
```

Requires Google Chrome installed. The session is stored in `~/.tl2api/browser-data` (override with `TL2API_DATA_DIR`).

> Log in directly with username/email + password. Avoid "Sign in with Google" — Google blocks automated browsers.

To watch the browser work (debugging), start headful: `HEADLESS=false tl2api`.

**From source (dev):**

```bash
git clone https://github.com/cjinghong/tl2api.git && cd tl2api
npm install
npx playwright install chrome
npm run login
npm start
```

## Usage

```
GET http://localhost:3000/tweets
```

| Param       | Type    | Default | Notes                              |
|-------------|---------|---------|------------------------------------|
| `count`     | int     | `20`    | 1–200. Number of tweets to return. |
| `filterAds` | boolean | `true`  | Strip promoted tweets / ads.       |

Headless mode is set once at startup via the `HEADLESS` env var (default `true`), not per request — the warm browser runs in a single mode for its lifetime.

Examples:

```bash
curl "http://localhost:3000/tweets?count=10"
curl "http://localhost:3000/tweets?count=50&filterAds=false"
```

Other endpoints: `GET /health`, `GET /` (usage hint).

## Use as an MCP server (for agents)

Coding agents can consume tl2api as an [MCP](https://modelcontextprotocol.io) server exposing a `get_timeline` tool, instead of the HTTP API. It reuses the same warm browser and the same saved session.

```bash
claude mcp add tl2api -- tl2api-mcp   # Claude Code (after npm i -g tl2api)
```

For other clients (Cursor, Cline, Claude Desktop), set `command: "tl2api-mcp"`. Install globally first so the first connection is fast — an `npx` first-run downloads Playwright and may time out the client.

> The MCP server and HTTP server lock the same `~/.tl2api/browser-data` profile — run **one at a time**.

Full agent setup instructions: [`docs/agent-install.html`](docs/agent-install.html) / [`docs/agent-install.md`](docs/agent-install.md).

## Response shape

```jsonc
{
  "count": 10,
  "requestedCount": 10,
  "filterAds": true,
  "tweets": [
    {
      "id": "1234567890",
      "url": "https://x.com/user/status/1234567890",
      "author": { "handle": "@user", "displayName": "User", "avatarUrl": "...", "verified": true },
      "text": "the tweet text\nwith newlines",
      "timestamp": "2026-05-25T13:09:01.000Z",
      "metrics": { "replies": 96, "retweets": 59, "likes": 1190, "views": 245211, "bookmarks": 177 },
      "media": [{ "type": "photo", "url": "https://pbs.twimg.com/media/..." }],
      "isPromoted": false,
      "isRetweet": false,
      "retweetedBy": null,
      "quotedTweet": { "author": { "handle": "@other", "displayName": "Other" }, "text": "...", "url": "..." },
      "lang": "en"
    }
  ]
}
```

Numbers like `1.2K` / `3.4M` are parsed to integers. Promoted tweets have no timestamp (X omits it) — `filterAds=true` removes them anyway.

## Use cases

- **Personal timeline archive** — periodically snapshot your home feed to JSON for backup or search.
- **Local AI / LLM feed** — pipe tweets into a summarizer, classifier, or agent without paying for X API access.
- **Custom filtering & digests** — build your own muted-keyword filter, "top of my feed" email digest, or RSS bridge.
- **Sentiment / trend analysis** — collect metrics (likes, reposts, views) over time for the accounts you follow.
- **Read-it-later / dedup** — dump the timeline into a database to triage tweets later without the algorithmic reshuffle.
- **Research datasets** — gather your own-feed data for personal NLP experiments.

## Notes

- Single-process: one scrape runs at a time (concurrent requests get `429`).
- `401` means the session expired — re-run `tl2api-login`.
- `~/.tl2api/browser-data` holds your live X session (override with `TL2API_DATA_DIR`). **Never commit or share it.**
- This automates your own logged-in browser. Use it for personal data access and respect X's Terms of Service.
