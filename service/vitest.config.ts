import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    css: true,
  },
});
