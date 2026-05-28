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

- **The agent** does all the mechanical setup (install, configure).
- **A human** runs `tl2api-login` **exactly once** — a Chrome window opens, they log into X, then press ENTER. The session is saved to `~/.tl2api/browser-data`.

Both the MCP server and the HTTP API read that same saved session. Login is done once and is independent of which form factor you use.

If no valid session exists, `get_timeline` (or `GET /tweets`) returns a **"Not logged in"** error. When you see it, ask the human to run `tl2api-login`.

---

## Prerequisites

- **Node.js 18+**.
- **Google Chrome** installed (Playwright drives your real Chrome via `channel: 'chrome'`).
- A **human** available for the one-time login.

---

## Install (from npm)

```bash
npm i -g tl2api
```

This installs three commands:

- `tl2api` — the HTTP server
- `tl2api-login` — the one-time human login
- `tl2api-mcp` — the MCP server

> First install pulls in Playwright (large download) — let it finish.
>
> **From source instead:** `git clone https://github.com/cjinghong/tl2api.git && cd tl2api && npm install`, then use `npm run login`, `npm start`, `npm run mcp`.

## One-time login (a human runs this)

```bash
tl2api-login
```

A Chrome window opens. The human:

1. Logs into X with **username/email + password** (avoid "Sign in with Google" — Google blocks automated browsers).
2. Waits until the home timeline at `x.com/home` is visible.
3. Presses **ENTER** in the terminal to save the session and close.

The session is written to `~/.tl2api/browser-data` (override the location with the `TL2API_DATA_DIR` env var). Never commit or share that directory — it holds your live X session.

---

## Option A (recommended): MCP server

The MCP server exposes a single tool, **`get_timeline`**, over stdio. Configure your client to run **`tl2api-mcp`**.

> **Install globally first** (`npm i -g tl2api`) so the first MCP connection is fast. If you point the client at `npx -y tl2api-mcp` instead, the very first run downloads Playwright and may exceed the client's startup timeout.

### Claude Code

```bash
claude mcp add tl2api -- tl2api-mcp
```

### Cursor / Cline / Claude Desktop (and other `mcpServers` clients)

```json
{
  "mcpServers": {
    "tl2api": {
      "command": "tl2api-mcp",
      "env": { "HEADLESS": "true" }
    }
  }
}
```

If a client can't find `tl2api-mcp` on `PATH`, use the absolute path from `which tl2api-mcp`, or set `command` to `npx` with `args: ["-y", "tl2api-mcp"]`.

### Tool: `get_timeline`

| Argument    | Type    | Default | Notes                                |
|-------------|---------|---------|--------------------------------------|
| `count`     | integer | `20`    | 1–200. How many tweets to return.    |
| `filterAds` | boolean | `true`  | Strip promoted/ad tweets.            |

Returns a JSON text block: `{ count, requestedCount, filterAds, tweets: [ ... ] }`. See **Response shape** below.

If the session is missing or expired, the tool result has `isError: true` and text telling the human to run `tl2api-login`.

---

## Option B (fallback): HTTP API

For agents without MCP support. Start the server, then make HTTP requests.

```bash
tl2api    # serves http://localhost:3000   (use: HEADLESS=false tl2api  to watch the browser)
```

```bash
curl "http://localhost:3000/tweets?count=20&filterAds=true"
```

Query params: `count` (1–200, default 20), `filterAds` (boolean, default true). Other endpoints: `GET /health`, `GET /`.

`HEADLESS` is a **startup** setting (env var, default `true`), not a per-request param — the warm browser runs in one mode for its lifetime.

---

## Important constraint: one consumer at a time

The MCP server and the HTTP server both lock the **same** `~/.tl2api/browser-data` Chrome profile. Run **only one at a time**. For an MCP-capable agent, that means run just the MCP server — you do **not** also need to start the HTTP server.

Re-running `tl2api-login` also needs the profile, so stop the running server first if a session refresh is required.

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
| `Not logged in` error (MCP) / HTTP `401` | No valid session. A human runs `tl2api-login`. Stop the running server first (profile lock). |
| `tl2api-mcp: command not found` | Install globally: `npm i -g tl2api`, or use `npx -y tl2api-mcp` / an absolute path. |
| MCP client times out on first connect | First `npx` run is downloading Playwright. Install globally first so startup is instant. |
| HTTP `429` "Scrape in progress" | A scrape is already running; retry shortly. (The MCP server serializes calls automatically, so it won't 429.) |
| MCP client shows protocol/parse errors | The server was launched via `npm run`; run the `tl2api-mcp` binary (or `node .../src/mcp.js`) directly instead — `npm`'s banner corrupts stdio. |
| Chrome not found at launch | Install Google Chrome (the code uses your system Chrome). |
| Profile lock / can't launch | Another consumer (HTTP server or a second MCP instance) holds `~/.tl2api/browser-data`. Run only one. |
