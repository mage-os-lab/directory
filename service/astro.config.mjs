// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  srcDir: 'src/site',
  output: 'static',
  outDir: 'dist',
  // The canonical host; overridable so preview builds on another origin (or a
  // subpath) get the right absolute URLs.
  site: process.env.SITE_URL || 'https://directory.mage-os.org',
  base: process.env.BASE_PATH || '/',
  integrations: [preact()],
  build: {
    format: 'directory',
  },
});
