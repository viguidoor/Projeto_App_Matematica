/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

// Testes contra a stack LOCAL (Docker): `npm run db:up` antes. Não usam nuvem nem serviços pagos.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests-supabase/**/*.test.ts'],
    globalSetup: ['./tests-supabase/globalSetup.ts'],
    // Todos os arquivos usam o mesmo banco: um por vez.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
