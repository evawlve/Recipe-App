import 'server-only';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';

const USDA_PATH = path.join(process.cwd(), 'data/usda/fdc.json'); // keep outside /public

export async function readUSDAJsonRaw(): Promise<string> {
  // only for scripts/admin tools; avoid in RSC pages
  return fs.readFile(USDA_PATH, 'utf8');
}

export function streamUSDAJson() {
  // for large, line-by-line processing in scripts
  return createReadStream(USDA_PATH, { encoding: 'utf8' });
}
