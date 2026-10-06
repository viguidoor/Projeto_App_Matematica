import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseRepository } from '../src/data/supabase/supabaseRepository';
import { ENV } from './env';
import { disposeAll, loginTeacher, newDevice, resetData } from './world';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number, step = 50) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(step);
  }
  return cond();
}
const sub = (a: string) => ({ calculation: '8 x 5 : 2', rawAnswer: a, unit: 'm²' as const, justification: 'Metade do produto das diagonais.' });

let teacherA: SupabaseRepository;
let teacherB: SupabaseRepository;

beforeAll(async () => {
  await resetData();
  // pollMs enorme: se o painel atualizar, foi pelo TEMPO REAL, não pela consulta periódica
  teacherA = await loginTeacher('a', { pollMs: 600_000 });
  teacherB = await loginTeacher('b', { pollMs: 600_000 });

  // Aquecimento: o globalSetup acabou de RECRIAR as tabelas, e o Realtime leva alguns segundos para enxergar as novas.
  // (Em produção as tabelas são criadas uma vez, antes de qualquer assinatura.) Medimos esse tempo em vez de escondê-lo.
  const warm = await teacherA.openSession();
  let hits = 0;
  const off = teacherA.subscribe(() => (hits += 1));
  const t0 = Date.now();
  await until(() => teacherA.realtimeState === 'subscribed', 20_000);
  while (hits === 0 && Date.now() - t0 < 60_000) {
    await teacherA.addNote(warm.code, { team: null, difficulty: 'aquecimento', intervention: '', response: '' });
    await sleep(1_000);
  }
  console.log(`[tempo real] primeira entrega de evento após recriar as tabelas: ${Date.now() - t0} ms`);
  off();
  expect(hits).toBeGreaterThan(0);
});
afterAll(disposeAll);

describe('tempo real do painel do professor', () => {
  it('o painel é avisado em poucos segundos quando uma equipe entra e responde, sem recarregar e sem consulta periódica', async () => {
    const s = await teacherA.openSession();
    let calls = 0;
    const off = teacherA.subscribe(() => (calls += 1));
    expect(await until(() => teacherA.realtimeState === 'subscribed', 15_000)).toBe(true);
    expect(teacherA.connection.get()).toBe('connected');

    const before = calls;
    const t0 = Date.now();
    const device = newDevice();
    const team = await device.joinSession(s.code, 'Equipe Tempo Real');
    expect(await until(() => calls > before, 5_000)).toBe(true);
    const joinLatency = Date.now() - t0;
    expect((await teacherA.listTeams(s.code)).map((t) => t.alias)).toEqual(['Equipe Tempo Real']);

    const mid = calls;
    const t1 = Date.now();
    await device.submitDiagnostic(team.id, sub('20'));
    expect(await until(() => calls > mid, 5_000)).toBe(true);
    const answerLatency = Date.now() - t1;
    expect((await teacherA.listTeams(s.code))[0].diagnostic?.answer).toBe(20);

    await device.saveProgress(team.id, { phase: 'hipotese' });
    await device.submitHypothesis(team.id, { ...sub('60'), calculation: '10 x 6' });
    const beforeHint = calls;
    await device.recordHint(team.id, 1); // dicas só depois da hipótese inicial
    expect(await until(() => calls > beforeHint, 5_000)).toBe(true);
    console.log(`[tempo real] latência até o painel ser avisado: entrada ${joinLatency} ms, resposta ${answerLatency} ms (inclui o envio)`);
    off();
  });

  it('as notas e a projeção do professor também chegam ao painel em tempo real', async () => {
    const s = await teacherA.openSession();
    let calls = 0;
    const off = teacherA.subscribe(() => (calls += 1));
    await until(() => teacherA.realtimeState === 'subscribed', 15_000);
    const before = calls;
    await teacherA.addNote(s.code, { team: null, difficulty: 'nota em tempo real', intervention: '', response: '' });
    expect(await until(() => calls > before, 5_000)).toBe(true);
    const mid = calls;
    await teacherA.setProjection({ kind: 'distribution', stage: 'diagnostico', showCorrect: false });
    expect(await until(() => calls > mid, 5_000)).toBe(true);
    off();
  });

  it('rajadas de eventos são agrupadas (o painel não recarrega uma vez por evento)', async () => {
    const s = await teacherA.openSession();
    let calls = 0;
    const off = teacherA.subscribe(() => (calls += 1));
    await until(() => teacherA.realtimeState === 'subscribed', 15_000);
    await sleep(500);
    const before = calls;
    await Promise.all(Array.from({ length: 8 }, (_, i) => newDevice().joinSession(s.code, `Equipe Rajada ${i + 1}`)));
    await sleep(2_500);
    expect(calls - before).toBeGreaterThanOrEqual(1);
    expect(calls - before).toBeLessThan(8);
    expect((await teacherA.listTeams(s.code)).length).toBe(8);
    off();
  });

  it('o professor B NÃO é avisado de nada da sessão do professor A (o Realtime respeita as regras de acesso)', async () => {
    const sA = await teacherA.openSession();
    await teacherB.openSession();
    let callsB = 0;
    const off = teacherB.subscribe(() => (callsB += 1));
    await until(() => teacherB.realtimeState === 'subscribed', 15_000);
    await sleep(800);
    const before = callsB;
    const device = newDevice();
    const team = await device.joinSession(sA.code, 'Equipe do Professor A');
    await device.submitDiagnostic(team.id, sub('20'));
    await sleep(3_000);
    expect(callsB - before).toBe(0);
    off();
  });

  it('um estudante que assina o canal de mudanças não recebe nenhum evento de ninguém', async () => {
    const s = await teacherA.openSession();
    const student = createClient(ENV.url, ENV.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await student.auth.signInAnonymously();
    const events: unknown[] = [];
    let status = '';
    const ch = student.channel('espiao');
    for (const table of ['teams', 'submissions', 'hint_events', 'interventions', 'projection', 'sessions']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, (e) => events.push(e));
    }
    ch.subscribe((st) => (status = st));
    await until(() => status === 'SUBSCRIBED', 15_000);
    await sleep(500);

    const device = newDevice();
    const team = await device.joinSession(s.code, 'Equipe Observada');
    await device.submitDiagnostic(team.id, sub('20'));
    await teacherA.addNote(s.code, { team: null, difficulty: 'segredo', intervention: '', response: '' });
    await sleep(3_000);
    expect(events).toEqual([]); // sem permissão de leitura, o Realtime não entrega nada
    await student.removeAllChannels();
    await student.auth.signOut();
  });
});

describe('rede de segurança: reconciliação periódica mesmo com o tempo real saudável', () => {
  it('o painel recarrega sozinho de tempos em tempos, sem nenhum evento (falha silenciosa não deixa o painel velho)', async () => {
    const t = await loginTeacher('a', { pollMs: 200, reconcileMs: 1_000 });
    await t.openSession();
    let calls = 0;
    const off = t.subscribe(() => (calls += 1));
    await until(() => t.realtimeState === 'subscribed', 15_000);
    await sleep(500);
    const before = calls;
    await sleep(3_500); // nenhum evento no banco neste intervalo
    expect(calls - before).toBeGreaterThanOrEqual(2);
    expect(calls - before).toBeLessThanOrEqual(5);
    off();
  });
});

describe('sem tempo real: consulta periódica de reserva', () => {
  it('a TV (sem login) e o estudante são avisados pela consulta periódica', async () => {
    const s = await teacherA.openSession();
    const tv = newDevice({ pollMs: 300 }); // sem professor logado: sem Realtime, só consulta periódica
    let calls = 0;
    const off = tv.subscribe(() => (calls += 1), { intervalMs: 300 });
    await sleep(1_500);
    expect(tv.realtimeState).toBe('off');
    expect(calls).toBeGreaterThanOrEqual(2);

    await teacherA.setProjection({ kind: 'distribution', stage: 'diagnostico', showCorrect: false });
    for (let i = 0; i < 3; i += 1) {
      const d = newDevice();
      const team = await d.joinSession(s.code, `Equipe TV ${i + 1}`);
      await d.submitDiagnostic(team.id, sub('20'));
    }
    const view = await tv.getProjectionView(s.code);
    expect(view.kind === 'distribution' && view.distribution).toMatchObject({ total: 3, suppressed: false, entries: [{ label: '20 m²', count: 3, correct: true }] });
    off();
    const stopped = calls;
    await sleep(1_000);
    expect(calls).toBe(stopped); // cancelar a assinatura para a consulta
  });

  it('o aviso de "sessão encerrada" chega ao estudante pela consulta periódica', async () => {
    const s = await teacherA.openSession();
    const device = newDevice({ pollMs: 300 });
    const team = await device.joinSession(s.code, 'Equipe Aviso');
    let closed = false;
    const off = device.subscribe(
      () => {
        device.getTeam(team.id).then((t) => {
          if (t?.sessionClosed) closed = true;
        });
      },
      { intervalMs: 300 },
    );
    await teacherA.closeSession(s.code);
    expect(await until(() => closed, 5_000)).toBe(true);
    off();
  });
});
