import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { createApp } from '../server/app.mjs';

let server, origin, sample;
before(async () => {
  const manifest = JSON.parse(await readFile(new URL('../.generated/sample-manifest.json', import.meta.url)));
  sample = manifest.fill;
  await new Promise(resolve => { server = createApp().listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
function request(route, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    http.get(origin + route, { headers, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    }).on('error', reject);
  });
}
test('page entry, legacy bookmarks and health endpoint', async () => {
  for (const route of ['/', '/index.html', '/biji-repaint.html', '/biji-web.html']) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.match(response.body.toString(), /<title>绘画记录<\/title>/);
    assert.match(response.body.toString(), /type="module"/);
    assert.equal(response.headers['cache-control'], 'no-cache');
  }
  assert.equal(JSON.parse((await request('/healthz')).body).status, 'ok');
});
test('source, configuration, private files and traversal are not published', async () => {
  for (const route of ['/src/main.js', '/samples/sample-fill.json', '/package.json', '/.git/config', '/work/photo-before.json', '/assets/%2e%2e/package.json', '/assets/.env']) {
    assert.equal((await request(route)).status, 404, route);
  }
});
test('precompressed assets, content type, caching, HEAD and ETag', async () => {
  const original = await request(sample, { 'Accept-Encoding': 'identity' });
  assert.equal(original.status, 200);
  assert.match(original.headers['cache-control'], /immutable/);
  for (const encoding of ['gzip', 'br']) {
    const response = await request(sample, { 'Accept-Encoding': encoding });
    assert.equal(response.headers['content-encoding'], encoding);
    assert.match(response.headers['content-type'], /application\/json/);
    assert.equal(response.headers.vary, 'Accept-Encoding');
    assert.deepEqual(encoding === 'gzip' ? gunzipSync(response.body) : brotliDecompressSync(response.body), original.body);
    assert(response.body.length < original.body.length / 2);
    assert.equal((await request(sample, { 'Accept-Encoding': encoding, 'If-None-Match': response.headers.etag })).status, 304);
  }
  const disabled = await request(sample, { 'Accept-Encoding': 'gzip;q=0, br;q=0' });
  assert.equal(disabled.headers['content-encoding'], undefined);
  const head = await request(sample, { 'Accept-Encoding': 'gzip' }, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
});
