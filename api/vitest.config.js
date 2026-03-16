import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js', 'tests/**/*.prop.test.js'],
    testTimeout: 30000,
    hookTimeout: 10000,
  },
});
