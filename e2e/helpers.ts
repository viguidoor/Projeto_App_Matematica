import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { ENV, TEACHERS } from '../tests-supabase/env';

export { ENV, TEACHERS };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Actor {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Erros do console do navegador (a suíte exige que não haja erros inesperados). */
  errors: string[];
}

/** Um "navegador" independente: contexto próprio, com armazenamento e login próprios. */
export async function newActor(browser: Browser, name: string): Promise<Actor> {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'pt-BR' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return { name, context, page, errors };
}

// ------------------------------------------------------------------ professor

export async function teacherLogin(page: Page, which: keyof typeof TEACHERS = 'a') {
  await page.goto('/#/professor');
  await page.getByLabel('E-mail da conta docente').fill(TEACHERS[which].email);
  await page.getByLabel('Senha').fill(TEACHERS[which].password);
  await page.getByRole('button', { name: 'Entrar como professor' }).click();
  await expect(page.getByRole('heading', { name: 'Painel do professor' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Abrir sessão|Abrir nova sessão/ })).toBeVisible();
}

export async function openSession(page: Page): Promise<string> {
  await page.getByRole('button', { name: /Abrir sessão|Abrir nova sessão/ }).click();
  const code = page.locator('.session-code');
  await expect(code).toHaveText(/^[A-Z2-9]{6}$/);
  return (await code.textContent())!.trim();
}

export const teamRow = (page: Page, alias: string) => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: alias }) });

// ------------------------------------------------------------------ estudante

export async function studentJoin(page: Page, code: string, alias: string) {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByLabel('Código da sessão').fill(code);
  await page.getByLabel('Apelido da equipe').fill(alias);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Questão diagnóstica' })).toBeVisible();
}

export interface Answer {
  calc: string;
  answer: string;
  why: string;
  unit?: 'm' | 'm²';
}

export async function fillAnswer(page: Page, a: Answer) {
  await page.getByLabel('Cálculo da equipe').fill(a.calc);
  await page.getByLabel('Área encontrada (número)').fill(a.answer);
  await page.getByRole('radio', { name: a.unit === 'm' ? /^m \(metro\)/ : /m² \(metro quadrado\)/ }).check();
  await page.getByLabel(/Justificativa/).fill(a.why);
}

export async function submitDiagnostic(page: Page, a: Answer) {
  await fillAnswer(page, a);
  await page.getByRole('button', { name: 'Enviar diagnóstico' }).click();
  await expect(page.getByRole('heading', { name: /Hipótese inicial: explorem o jardim/ })).toBeVisible();
}

export async function submitInitialHypothesis(page: Page, a: Answer) {
  await page.getByRole('button', { name: /Registrar hipótese inicial/ }).click();
  await expect(page.getByRole('heading', { name: 'Hipótese inicial da equipe' })).toBeVisible();
  await fillAnswer(page, a);
  await page.getByRole('button', { name: 'Enviar hipótese inicial' }).click();
  await expect(page.getByRole('heading', { name: 'Devolutiva da hipótese inicial' })).toBeVisible();
}

export async function goToFinalAndFinish(page: Page, a: Answer) {
  await page.getByRole('button', { name: 'Ir ao problema final' }).first().click();
  const confirm = page.getByRole('button', { name: 'Sim, ir ao problema final' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByRole('heading', { name: 'Problema final' })).toBeVisible();
  await fillAnswer(page, a);
  await page.getByRole('button', { name: 'Enviar resolução final' }).click();
  await expect(page.getByRole('heading', { name: 'Missão concluída' })).toBeVisible();
}

/** Chama o servidor DE VERDADE com o login do próprio estudante (o mesmo token que o aplicativo guarda). */
export async function studentApi(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
  return page.evaluate(
    async ({ url, key, path, init }) => {
      const raw = window.sessionStorage.getItem('operacao-area-estudante');
      const token = raw ? JSON.parse(raw).access_token : key;
      const res = await fetch(`${url}${path}`, {
        method: init.method ?? 'GET',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* corpo vazio */
      }
      return { status: res.status, json, text };
    },
    { url: ENV.url, key: ENV.anonKey, path, init },
  );
}

// ------------------------------------------------------------------ infraestrutura

export async function withDb<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ host: ENV.dbHost, port: ENV.dbPort, user: 'postgres', password: ENV.dbPassword, database: 'postgres' });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export async function dbCount(sql: string, args: unknown[] = []): Promise<number> {
  return withDb(async (db) => Number((await db.query(sql, args)).rows[0].n));
}

const composeEnv = () => ({
  ...process.env,
  ...Object.fromEntries(
    readFileSync(join(import.meta.dirname, '..', 'infra', 'local', '.env'), 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  ),
});
export function compose(cmd: string) {
  return execSync(`docker compose ${cmd}`, { cwd: join(import.meta.dirname, '..', 'infra', 'local'), stdio: 'pipe', env: composeEnv() });
}

/** Zera os dados de sessões entre os testes (mantém as contas de professor). */
export async function resetData() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await withDb(async (db) => {
        await db.query('begin');
        await db.query('delete from public.sessions');
        await db.query('truncate public.join_attempts');
        await db.query('delete from auth.users where is_anonymous');
        await db.query('commit');
      });
      return;
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(200 * attempt);
    }
  }
}

export async function closeActors(...actors: Actor[]) {
  for (const a of actors) await a.context.close();
}

/** Falha o teste se algum ator tiver erro inesperado no console (ignora falhas de rede provocadas de propósito). */
export function expectNoUnexpectedErrors(actors: Actor[], allowed: RegExp[] = []) {
  for (const a of actors) {
    const bad = a.errors.filter((e) => !allowed.some((re) => re.test(e)));
    expect(bad, `erros no console de ${a.name}`).toEqual([]);
  }
}
