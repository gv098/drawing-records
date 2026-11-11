import { readdir, readFile, writeFile } from 'node:fs/promises';
import { gzip, brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function compressDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await compressDirectory(file);
    else if (/\.(html|js|css|json|svg)$/.test(entry.name)) {
      const input = await readFile(file);
      await writeFile(file + '.gz', await promisify(gzip)(input, { level: 6 }));
      await writeFile(file + '.br', await promisify(brotliCompress)(input, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
      }));
    }
  }
}
await compressDirectory(fileURLToPath(new URL('../dist/', import.meta.url)));
console.log('Production gzip and Brotli assets ready.');
