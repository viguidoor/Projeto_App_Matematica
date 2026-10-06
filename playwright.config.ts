import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E reais: navegador de verdade + app + stack Supabase LOCAL (Docker). Sem mocks do Supabase.
const env = Object.fromEntries(
  readFileSync(join(import.meta.dirname, 'infra', 'local', '.env'), 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Todos os testes compartilham o mesmo banco e alguns derrubam o Realtime: um de cada vez.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 150_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-resultados',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'pt-BR',
    viewport: { width: 1024, height: 768 }, // tablet
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      // Build de CONEXÃO: só a chave PÚBLICA vai para o navegador.
      VITE_BACKEND: 'supabase',
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: env.ANON_KEY,
    },
  },
});
