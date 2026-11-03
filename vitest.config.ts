import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // Node 25+ ships a global localStorage that shadows jsdom's (and is broken
    // without --localstorage-file); turn it off so tests get jsdom's.
    execArgv: ['--no-experimental-webstorage'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts']
    }
  }
})
