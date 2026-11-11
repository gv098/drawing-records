import { readFileSync } from 'node:fs';
import path from 'node:path';

// The drawing engine uses shared lexical state. Resolve the existing source
// fragments at compile time, keeping them scoped inside the app/worker module.
export function drawingRuntime() {
  const entries = new Set();
  return {
    name: 'drawing-runtime',
    enforce: 'pre',
    transform(code, id) {
      const filename = id.split('?')[0];
      if (!/[\\/]src[\\/](main|worker)\.js$/.test(filename)) return null;
      entries.add(id);
      const result = code.replace(/\/\* @include (runtime\/[\w-]+\.js) \*\//g, (_, relative) => {
        const dependency = path.resolve(path.dirname(filename), relative);
        this.addWatchFile(dependency);
        return readFileSync(dependency, 'utf8');
      });
      return { code: result, map: null };
    },
    handleHotUpdate({ file, server }) {
      if (!/[\\/]src[\\/]runtime[\\/]/.test(file)) return;
      for (const id of entries) {
        const mod = server.moduleGraph.getModuleById(id);
        if (mod) server.moduleGraph.invalidateModule(mod);
      }
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
