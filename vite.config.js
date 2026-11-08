import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Each Pages build publishes its own identifier. The running app can compare
// this against app-version.json to detect new deployments without push alerts.
const buildId = process.env.GITHUB_SHA || `local-${Date.now()}`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-app-version',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'app-version.json',
          source: JSON.stringify({ buildId }),
        });
      },
    },
  ],
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  base: '/my-fuel-price-monitor/',
});
