import { existsSync } from 'node:fs';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { createApp, defaultDist } from './app.mjs';

if (!existsSync(path.join(defaultDist, 'index.html'))) {
  console.error('请先运行 npm run build，再运行 npm start。');
  process.exit(1);
}
const port = Number(process.env.PORT || 8766);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const server = createApp().listen(port, host, () => {
  console.log(`绘画记录：http://localhost:${port}`);
  if (host === '0.0.0.0') for (const list of Object.values(networkInterfaces())) {
    for (const address of list || []) if (address.family === 'IPv4' && !address.internal) {
      console.log(`局域网：http://${address.address}:${port}`);
    }
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请先停止旧服务或设置 PORT。` : error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
