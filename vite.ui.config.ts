/**
 * Library-mode build for the embeddable bundle: directory-ui.js (+ .css for
 * shadow:false embedders; shadow mounts inline the styles automatically).
 * Run: npm run build:ui → dist-ui/
 */
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist-ui',
    lib: {
      entry: 'src/ui/mount.tsx',
      name: 'MageOSDirectory',
      fileName: 'directory-ui',
      formats: ['es', 'iife'],
    },
    cssCodeSplit: false,
  },
});
