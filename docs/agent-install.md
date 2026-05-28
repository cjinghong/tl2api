# tl2api — install as an agent tool

`tl2api` returns the **X (Twitter) home timeline** of a logged-in user as structured JSON, by driving a real logged-in Chrome session via Playwright. No X API key, no developer account.

It can be consumed two ways:

- **MCP server** (recommended for coding agents) — exposes a `get_timeline` tool.
- **HTTP API** (universal fallback) — `GET /tweets` for any agent that can run a shell / `curl`.

This document is written for an autonomous coding agent setting the tool up for its own use.

---

## READ FIRST: one unavoidable human step

This tool reads tweets from a **human's logged-in X account**. An agent **cannot** complete the login autonomously — it needs a person to enter credentials and pass 2FA, and automating that risks account lockout.

So the split is:

- **The agent** does all the mechanical setup (clone, install, configure).
- **A human** runs `npm run login` **exactly once** — a Chrome window opens, they log into X, then press ENTER. The session is saved to `browser-data/`.

Both the MCP server and the HTTP API read that same saved session. Login is done once and is independent of which form factor you use.

If no valid session exists, `get_timeline` (or `GET /tweets`) returns a **"Not logged in"** error. When you see it, ask the human to run `npm run login`.

---

## Prerequisites

- **Node.js 18+** (the project is ESM).
- **Google Chrome** installed (Playwright drives your real Chrome).
- A **human** available for the one-time login.

---

## Install

```bash
git clone https://github.com/cjinghong/tl2api.git tl-2-api
cd tl-2-api
npm install
npx playwright install chrome
```

## One-time login (human runs this)

```bash
npm run login
```

A Chrome window opens. The human:

1. Logs into X with **username/email + password** (avoid "Sign in with Google" — Google blocks automated browsers).
2. Waits until the home timeline at `x.com/home` is visible.
3. Presses **ENTER** in the terminal to save the session and close.

The session is written to `browser-data/` (gitignored — never commit or share it).

---

## Option A (recommended): MCP server

The MCP server exposes a single tool, **`get_timeline`**, over stdio.

> Configure your client to launch it with an **absolute path**, calling **`node` directly** — do **not** wrap it in `npm run`, whose startup banner is printed to stdout and corrupts the stdio JSON-RPC channel.

Replace `/absolute/path/to/tl-2-api` with the real clone path (run `pwd` in the repo).

### Claude Code

```bash
claude mcp add tl2api -- node /absolute/path/to/tl-2-api/src/mcp.js
```

### Cursor / Cline / Claude Desktop (and other `mcpServers` clients)

```json
{
  "mcpServers": {
    "tl2api": {
      "command": "node",
      "args": ["/absolute/path/to/tl-2-api/src/mcp.js"],
      "env": { "HEADLESS": "true" }
    }
  }
}
```

### Tool: `get_timeline`

| Argument    | Type    | Default | Notes                                |
|-------------|---------|---------|--------------------------------------|
| `count`     | integer | `20`    | 1–200. How many tweets to return.    |
| `filterAds` | boolean | `true`  | Strip promoted/ad tweets.            |

Returns a JSON text block: `{ count, requestedCount, filterAds, tweets: [ ... ] }`. See **Response shape** below.

If the session is missing or expired, the tool result has `isError: true` and text telling the human to run `npm run login`.

---

## Option B (fallback): HTTP API

For agents without MCP support. Start the server, then make HTTP requests.

```bash
npm start    # serves http://localhost:3000   (use: HEADLESS=false npm start  to watch the browser)
```

```bash
curl "http://localhost:3000/tweets?count=20&filterAds=true"
```

Query params: `count` (1–200, default 20), `filterAds` (boolean, default true). Other endpoints: `GET /health`, `GET /`.

`HEADLESS` is a **startup** setting (env var, default `true`), not a per-request param — the warm browser runs in one mode for its lifetime.

---

## Important constraint: one consumer at a time

The MCP server and the HTTP server both lock the **same** `browser-data/` Chrome profile. Run **only one at a time**. For an MCP-capable agent, that means run just the MCP server — you do **not** also need `npm start`.

Re-running `npm run login` also needs the profile, so stop the running server first if a session refresh is required.

## Performance

- **First call** cold-starts Chrome (~4s).
- **Later calls** reuse the warm browser and just reload the timeline (~2s).
- After **30 minutes idle**, Chrome shuts down; the next call cold-starts again.

---

## Response shape (per tweet)

```jsonc
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
```

Counts like `1.2K` / `3.4M` are parsed to integers. Promoted tweets have no timestamp; `filterAds=true` removes them.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Not logged in` error (MCP) / HTTP `401` | No valid session. A human runs `npm run login`. Stop the running server first (profile lock). |
| HTTP `429` "Scrape in progress" | A scrape is already running; retry shortly. (The MCP server serializes calls automatically, so it won't 429.) |
| MCP client shows protocol/parse errors | The server command was wrapped in `npm run`; call `node /abs/path/src/mcp.js` directly instead. |
| Chrome not found at launch | `npx playwright install chrome`. |
| Profile lock / can't launch | Another consumer (HTTP server or a second MCP instance) holds `browser-data/`. Run only one. |
