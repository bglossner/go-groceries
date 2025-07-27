import { defineConfig, type ServerOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const plugins = [react(), TanStackRouterVite()];

  if (mode === 'pwa') {
    console.log('PWA mode activated!');
    plugins.push(
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,webmanifest}'],
          runtimeCaching: [
            {
              urlPattern: /\/.*/,
              handler: 'CacheFirst',
            }
          ],
          cleanupOutdatedCaches: true,
        },
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
        manifest: {
          name: 'Go Groceries',
          short_name: 'Groceries',
          start_url: '/',
          description: 'A simple groceries helper app',
          display: 'standalone',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'supermarket_192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'supermarket_512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
          screenshots: [{
            src: 'chrome-dev-ss.png',
            sizes: '399x370',
            type: 'image/png',
            form_factor: "narrow",
            label: "Go Groceries",
            platform: 'android'
          }],
        },
        devOptions: {
          enabled: true,
        },
      }),
    );
  } else {
    console.log('Not in PWA mode: ' + mode);
  }

  const serverOptions = {
    watch: {
      usePolling: true,
    },
    port: mode === 'pwa' ? 5174 : undefined,
    host: mode === 'pwa',
    allowedHosts: mode === 'pwa' ? true : undefined,
  } satisfies ServerOptions;

  return {
    plugins,
    server: {
      ...serverOptions,
    },
    preview: {
      ...serverOptions,
    },
    esbuild: {
      drop: [],
    },
  };
});
