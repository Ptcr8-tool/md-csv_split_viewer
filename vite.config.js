import { defineConfig } from 'vite';

// The WebSocket is needed for Vite's development HMR, not for the installed app.
const productionCsp = {
  name: 'mdsplit-production-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const development = "connect-src 'self' ws://127.0.0.1:*";
    if (!html.includes(development)) throw new Error('Expected development CSP was not found');
    return html.replace(development, "connect-src 'self'");
  },
};

export default defineConfig({ base: './', plugins: [productionCsp], build: { target: 'es2022', chunkSizeWarningLimit: 1200, outDir: 'dist', sourcemap: false }, test: { include: ['tests/**/*.test.js'] } });
