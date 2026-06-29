import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE || 'http://localhost:8080'

  return {
    plugins: [react()],
    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
    server: {
      port: 5173,
      strictPort: true,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      proxy: {
        '/api': {
          target: apiBase,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/files': {
          target: apiBase,
        },

      },
    },
  }
})
