import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Tests read the stylesheet as text (for the reduced-motion rules); Vitest empties CSS it doesn't include.
    css: { include: [/sync-ui\.css/] },
  },
});
