import { mkdir, readFile, writeFile, copyFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'public/assets');
await mkdir(assets, { recursive: true });
await mkdir(path.join(root, '.generated'), { recursive: true });
const manifest = {};
for (const [key, input, name, ext] of [
  ['fill', 'sample-fill.json', 'sample-fill', 'json'],
  ['brush', 'sample-v3.json', 'sample-brush', 'json'],
  ['reference', 'reference.png', 'reference', 'png'],
]) {
  const source = path.join(root, 'samples', input);
  const digest = createHash('sha256').update(await readFile(source)).digest('hex').slice(0, 12);
  const filename = `${name}-${digest}.${ext}`;
  await copyFile(source, path.join(assets, filename));
  manifest[key] = `/assets/${filename}`;
}
// Remove only assets owned by this generator, never arbitrary public files.
const retained = new Set(Object.values(manifest).map(p => path.basename(p)));
for (const name of await readdir(assets)) {
  if (/^(sample-fill|sample-brush|reference)-[a-f0-9]{12}\.(json|png)$/.test(name) && !retained.has(name)) {
    await unlink(path.join(assets, name));
  }
}
await writeFile(path.join(root, '.generated/sample-manifest.json'), JSON.stringify(manifest));
console.log('Example assets prepared.');
