import { defineConfig } from 'vite';
import { drawingRuntime } from './scripts/drawing-runtime.mjs';

export default defineConfig({
  plugins: [drawingRuntime()],
  worker: { format: 'es', plugins: () => [drawingRuntime()] },
  server: { host: '0.0.0.0', port: Number(process.env.PORT || 8766), strictPort: true },
  build: { target: 'es2020', sourcemap: false },
});
