import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Base relative : l'application est un site statique sans routeur à chemin réel.
 * Elle fonctionne donc à la racine d'un domaine comme dans un sous-répertoire
 * (Dokploy, nginx, GitHub Pages) sans reconfiguration.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsDir: 'assets',
  },
});
