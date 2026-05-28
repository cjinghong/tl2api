import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getFreshTimeline, armIdleTimer, shutdown } from './browser.js';
import { scrapeTimeline } from './scraper.js';

// stdout is the JSON-RPC channel for stdio MCP; route any stray logging
// (e.g. browser.js status lines) to stderr so it can't corrupt the protocol.
console.log = (...args) => console.error('[tl2api]', ...args);

// One warm page means one scrape at a time; serialize tool calls so concurrent
// requests queue instead of fighting over the shared browser.
let lock = Promise.resolve();
function runExclusive(fn) {
  const run = lock.then(() => fn());
  lock = run.then(
    () => {},
    () => {}
  );
  return run;
}

const server = new McpServer({ name: 'tl2api', version: '0.1.0' });

server.registerTool(
  'get_timeline',
  {
    title: 'Get X (Twitter) home timeline',
    description:
      'Fetch recent tweets from the logged-in X (Twitter) home timeline as structured JSON ' +
      '(author, text, timestamp, metrics, media, retweet/quote info). Drives a real logged-in ' +
      'browser session — no X API key. Requires a one-time human `npm run login` to have saved ' +
      'a session; if not logged in, this returns an error telling the human to run it.',
    inputSchema: {
      count: z.number().int().min(1).max(200).default(20).describe('How many tweets to return (1-200).'),
      filterAds: z.boolean().default(true).describe('Strip promoted/ad tweets.'),
    },
  },
  async ({ count, filterAds }) => {
    try {
      const result = await runExclusive(async () => {
        const page = await getFreshTimeline();
        const tweets = await scrapeTimeline({ page, count, filterAds });
        return { count: tweets.length, requestedCount: count, filterAds, tweets };
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const text = msg.includes('Not logged in')
        ? 'Not logged in. A human must run `npm run login` once in a terminal (a Chrome window opens — log into X, press ENTER), then retry.'
        : `Failed to fetch timeline: ${msg}`;
      return { content: [{ type: 'text', text }], isError: true };
    } finally {
      armIdleTimer();
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.log('tl2api MCP server ready on stdio');

let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  await shutdown().catch(() => {});
  process.exit(0);
}

transport.onclose = cleanup;
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
