import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // El registro y la revision de version nueva se hacen a mano en src/registrarServiceWorker.ts,
      // para que la app se actualice sola aunque quede abierta varios dias sin cerrarse del todo.
      injectRegister: false,
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Te Lo Tengo Market - Ingreso',
        short_name: 'Te Lo Tengo',
        description: 'Registro de entrada y salida de trabajadores',
        theme_color: '#14532d',
        background_color: '#f8efe4',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png}'],
        // Agrega el manejo de notificaciones push al service worker generado por workbox.
        importScripts: ['push-handlers.js'],
      },
    }),
  ],
})
