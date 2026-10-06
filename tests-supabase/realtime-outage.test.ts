import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseRepository } from '../src/data/supabase/supabaseRepository';
import { disposeAll, loginTeacher, newDevice, resetData } from './world';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(step);
  }
  return cond();
}
const compose = (cmd: string) => execSync(`docker compose ${cmd}`, { cwd: join(import.meta.dirname, '..', 'infra', 'local'), stdio: 'pipe', env: { ...process.env, ...Object.fromEntries(readFileSync(join(import.meta.dirname, '..', 'infra', 'local', '.env'), 'utf8').split('\n').filter(Boolean).map((l: string) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) } });

let teacher: SupabaseRepository;
beforeAll(async () => {
  await resetData();
  teacher = await loginTeacher('a', { pollMs: 300, rejoinMs: 2_000 });
});
afterAll(async () => {
  try {
    compose('start realtime');
  } catch {
    /* já estava de pé */
  }
  await disposeAll();
});

describe('queda do serviço de tempo real (o painel continua funcionando)', () => {
  it('avisa "Reconectando", segue atualizando por consulta periódica e volta ao tempo real sozinho', async () => {
    const s = await teacher.openSession();
    const t0 = Date.now();
    const log = (m: string) => console.log(`[queda do tempo real] +${Date.now() - t0} ms: ${m} (estado=${teacher.connection.get()}, canal=${teacher.realtimeState})`);
    let calls = 0;
    const states: string[] = [];
    teacher.connection.subscribe(() => states.push(teacher.connection.get()));
    const off = teacher.subscribe(() => (calls += 1));
    expect(await until(() => teacher.realtimeState === 'subscribed', 20_000)).toBe(true);

    log('canal assinado');
    compose('stop realtime'); // derruba o serviço de tempo real
    log('serviço derrubado');
    expect(await until(() => teacher.realtimeState !== 'subscribed', 20_000)).toBe(true);
    log('canal caiu');
    expect(await until(() => teacher.connection.get() === 'reconnecting', 10_000)).toBe(true);

    // sem tempo real, as novas equipes ainda chegam ao painel pela consulta periódica
    const before = calls;
    await newDevice().joinSession(s.code, 'Equipe Durante a Queda');
    expect(await until(() => calls > before, 5_000)).toBe(true);
    expect((await teacher.listTeams(s.code)).map((t) => t.alias)).toContain('Equipe Durante a Queda');

    log('painel atualizou por consulta periódica');
    compose('start realtime');
    log('serviço religado');
    const sock = (teacher as unknown as { teacher: { realtime: { connectionState(): string; isConnected(): boolean } } }).teacher.realtime;
    for (let i = 0; i < 12; i += 1) {
      await sleep(2_000);
      log(`socket=${sock.connectionState()} conectado=${sock.isConnected()}`);
      if (teacher.realtimeState === 'subscribed') break;
    }
    expect(await until(() => teacher.realtimeState === 'subscribed' && teacher.connection.get() === 'connected', 60_000)).toBe(true);
    log('tempo real de volta');
    const mid = calls;
    const t1 = Date.now();
    let n = 0;
    while (calls === mid && Date.now() - t1 < 60_000) {
      await newDevice().joinSession(s.code, `Equipe Depois da Volta ${(n += 1)}`);
      await sleep(1_500);
    }
    log(`primeiro evento depois da volta após ${Date.now() - t1} ms (${n} tentativas)`);
    expect(calls).toBeGreaterThan(mid);
    expect(states).toContain('reconnecting');
    expect(states[states.length - 1]).toBe('connected');
    off();
  });
});
