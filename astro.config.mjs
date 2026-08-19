// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  srcDir: 'src/site',
  output: 'static',
  outDir: 'dist',
  // Overridable so fallback hosts (e.g. GitHub Pages project sites, which
  // serve from /<repo>/) can build with the right origin and subpath.
  site: process.env.SITE_URL || 'https://mage-os-directory.pages.dev',
  base: process.env.BASE_PATH || '/',
  integrations: [preact()],
  build: {
    format: 'directory',
  },
});
