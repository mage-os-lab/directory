/**
 * Library-mode build for the embeddable bundle: directory-ui.js / .iife.js +
 * directory-ui.css (for shadow:false embedders; shadow mounts inline the
 * styles automatically).
 *
 * Output goes to public/embed/ so the Astro build (and dev server) publishes
 * the bundle at /embed/* alongside the site — embedders load it straight from
 * the directory's own origin. Run: npm run build:ui
 */
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  // Don't copy public/ (the site's static dir, incl. pipeline output) into
  // the library output — this build *is* part of public/.
  publicDir: false,
  build: {
    outDir: 'public/embed',
    lib: {
      entry: 'src/ui/mount.tsx',
      name: 'MageOSDirectory',
      fileName: 'directory-ui',
      formats: ['es', 'iife'],
    },
    cssCodeSplit: false,
  },
});
