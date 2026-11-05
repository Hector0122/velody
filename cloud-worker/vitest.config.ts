import { defineConfig } from 'vitest/config'

// Plain Node tests: the Worker's handler is called directly with in-memory
// fakes of its R2 binding and a node:sqlite-backed D1 adapter (test/fakes.ts),
// so the real SQL in migrations/ is exercised without workerd.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' }
})
