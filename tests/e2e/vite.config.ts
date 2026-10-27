// Browser E2E only: the real app with src/lib/supabase.ts replaced by the in-memory stand-in.
//   npx vite --config tests/e2e/vite.config.ts --port 4174 --strictPort
import path from 'node:path';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import base from '../../vite.config';

const real = path.resolve(__dirname, '../../src/lib/supabase.ts');
const fake = path.resolve(__dirname, 'fakeSupabase.ts');

const swapSupabase: Plugin = {
  name: 'e2e-fake-supabase',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (!importer || !/lib[\\/]supabase(\.ts)?$/.test(source)) return null;
    const resolved = path.resolve(path.dirname(importer), source.endsWith('.ts') ? source : `${source}.ts`);
    return resolved === real ? fake : null;
  },
};

export default defineConfig((env) =>
  mergeConfig(typeof base === 'function' ? base(env) : base, {
    root: path.resolve(__dirname, '../..'),
    plugins: [swapSupabase],
  })
);
