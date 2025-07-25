import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const plugins = [react(), TanStackRouterVite()];

  if (mode === 'pwa') {
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
          ]
        },
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
        manifest: {
          name: 'Groceries Helper',
          short_name: 'Groceries',
          start_url: '/index.html',
          description: 'A simple groceries helper app',
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
            label: "Groceries Helper",
            platform: 'android'
          }],
        },
        devOptions: {
          enabled: true,
        },
      }),
    );
  }

  return {
    plugins,
    server: {
      watch: {
        usePolling: true,
      }
    }
  };
});
