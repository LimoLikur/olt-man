import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Workspace packages resolve to their TS sources (same as tsc and vitest).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    // The CSP has font-src 'self' (no data:), so fonts must stay separate files.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  // `pnpm --filter ui dev` against the dev stack behind caddy.
  server: { proxy: { '/api': { target: 'https://localhost', secure: false, changeOrigin: false } } },
});
