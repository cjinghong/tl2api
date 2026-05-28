import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Where the persistent X session (cookies/profile) lives. Defaults to a stable
// home-dir location so global/npx installs and `tl2api-login` all share one
// session regardless of cwd. Override with TL2API_DATA_DIR.
export const DATA_DIR = process.env.TL2API_DATA_DIR
  ? path.resolve(process.env.TL2API_DATA_DIR)
  : path.join(os.homedir(), '.tl2api', 'browser-data');

export function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}
