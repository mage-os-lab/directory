// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  srcDir: 'src/site',
  output: 'static',
  outDir: 'dist',
  site: 'https://mage-os-directory.pages.dev',
  integrations: [preact()],
  build: {
    format: 'directory',
  },
});
