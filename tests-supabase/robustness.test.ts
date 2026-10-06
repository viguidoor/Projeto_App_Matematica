import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RepositoryError } from '../src/data/repository';
import type { SupabaseRepository } from '../src/data/supabase/supabaseRepository';
import type { SubmissionInput } from '../src/domain/types';
import { disposeAll, loginTeacher, newDevice, resetData, withDb } from './world';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const req = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-000000000000`;
const sub = (answer: string, requestId?: string): SubmissionInput => ({
  calculation: '10 x 6 : 2',
  rawAnswer: answer,
  unit: 'm²',
  justification: 'Metade do retângulo que envolve o losango.',
  requestId,
});
const count = (sql: string, args: unknown[] = []) => withDb(async (db) => (await db.query(sql, args)).rows[0].n as number);
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof RepositoryError ? e.code : `ERRO:${(e as Error).message}`;
  }
};

let teacher: SupabaseRepository;
let sessionCode: string;

async function freshTeam(opts: Parameters<typeof newDevice>[0] = {}) {
  const device = newDevice(opts);
  const team = await device.joinSession(sessionCode, `Equipe ${Math.random().toString(36).slice(2, 7)}`);
  return { device, team };
}
async function toHypothesisForm(device: SupabaseRepository, id: string) {
  await device.submitDiagnostic(id, sub('20', undefined));
  await device.saveProgress(id, { phase: 'hipotese' });
}

beforeAll(async () => {
  await resetData();
  teacher = await loginTeacher('a');
  sessionCode = (await teacher.openSession()).code;
});
afterAll(disposeAll);

describe('idempotência e concorrência (as mesmas regras valem com abas e toques duplicados)', () => {
  it('10 envios simultâneos com o MESMO requestId gravam uma única linha e devolvem o mesmo resultado', async () => {
    const { device, team } = await freshTeam();
    const results = await Promise.all(Array.from({ length: 10 }, () => device.submitDiagnostic(team.id, sub('20', req(1)))));
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(await count(`select count(*)::int as n from public.submissions where team_id = $1`, [team.id])).toBe(1);
  });

  it('envios simultâneos DIFERENTES da hipótese inicial: só um vence, os outros são recusados', async () => {
    const { device, team } = await freshTeam();
    await toHypothesisForm(device, team.id);
    const outcomes = await Promise.all(Array.from({ length: 6 }, (_, i) => codeOf(device.submitHypothesis(team.id, sub(String(30 + i), req(100 + i))))));
    expect(outcomes.filter((o) => o === 'OK')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'INVALID_STATE')).toHaveLength(5);
    expect(await count(`select count(*)::int as n from public.submissions where team_id = $1 and kind = 'hipotese'`, [team.id])).toBe(1);
  });

  it('tentativas simultâneas depois da hipótese: só uma é aceita por vez (a equipe precisa voltar a explorar)', async () => {
    const { device, team } = await freshTeam();
    await toHypothesisForm(device, team.id);
    await device.submitHypothesis(team.id, sub('60', req(200)));
    await device.saveProgress(team.id, { phase: 'exploracao' });
    await device.saveProgress(team.id, { phase: 'hipotese' });
    const outcomes = await Promise.all(Array.from({ length: 5 }, (_, i) => codeOf(device.submitAttempt(team.id, sub('30', req(210 + i))))));
    expect(outcomes.filter((o) => o === 'OK')).toHaveLength(1);
    const t = (await device.getTeam(team.id))!;
    expect(t.attempts.map((a) => a.n)).toEqual([1]);
  });

  it('pedidos simultâneos da mesma dica registram uma só vez', async () => {
    const { device, team } = await freshTeam();
    await toHypothesisForm(device, team.id);
    await Promise.all(Array.from({ length: 6 }, () => device.recordHint(team.id, 1)));
    expect(await count(`select count(*)::int as n from public.hint_events where team_id = $1`, [team.id])).toBe(1);
    expect((await device.getTeam(team.id))!.hints.map((h) => h.level)).toEqual([1]);
  });

  it('duas abas do mesmo dispositivo (mesmo armazenamento) compartilham a mesma equipe', async () => {
    const { device, team } = await freshTeam();
    const sameDevice = newDevice({ studentStorage: (device as unknown as { __opts: { studentStorage: never } }).__opts.studentStorage });
    const again = await sameDevice.joinSession(sessionCode, 'Outro Nome');
    expect(again.id).toBe(team.id);
  });
});

describe('queda de rede: o envio é repetido sem duplicar', () => {
  /** Faz o servidor PROCESSAR a chamada, mas perde a resposta (pior caso para duplicação). */
  function loseFirstResponses(match: RegExp, times: number) {
    let lost = 0;
    const stats = { lost: 0, calls: 0 };
    const flaky: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const res = await fetch(input, init);
      if (match.test(url)) {
        stats.calls += 1;
        if (lost < times) {
          lost += 1;
          stats.lost = lost;
          await res.text();
          throw new TypeError('fetch failed');
        }
      }
      return res;
    };
    return { flaky, stats };
  }

  it('resposta perdida da hipótese inicial: o app repete com o mesmo identificador e há uma só linha', async () => {
    const { flaky, stats } = loseFirstResponses(/rpc\/submit_hypothesis/, 2);
    const { device, team } = await freshTeam({ fetch: flaky });
    await toHypothesisForm(device, team.id);
    const states: string[] = [];
    device.connection.subscribe(() => states.push(device.connection.get()));
    const h = await device.submitHypothesis(team.id, sub('60')); // sem requestId: o repositório cria um e o reutiliza
    expect(h.answer).toBe(60);
    expect(stats.lost).toBe(2);
    expect(stats.calls).toBe(3);
    expect(await count(`select count(*)::int as n from public.submissions where team_id = $1 and kind = 'hipotese'`, [team.id])).toBe(1);
    expect(states).toContain('reconnecting');
    expect(device.connection.get()).toBe('connected');
  });

  it('resposta perdida na entrada da sessão: repetir a entrada devolve a MESMA equipe', async () => {
    const { flaky, stats } = loseFirstResponses(/rpc\/join_session/, 1);
    const device = newDevice({ fetch: flaky });
    const team = await device.joinSession(sessionCode, 'Equipe Wi-Fi Ruim');
    expect(stats.lost).toBe(1);
    expect(await count(`select count(*)::int as n from public.teams where session_id = (select id from public.sessions where code = $1 order by created_at desc limit 1) and alias = 'Equipe Wi-Fi Ruim'`, [sessionCode])).toBe(1);
    expect(team.alias).toBe('Equipe Wi-Fi Ruim');
  });

  it('mudança de fase com resposta perdida: repetir o mesmo pedido não dá erro nem muda nada', async () => {
    const { flaky, stats } = loseFirstResponses(/rpc\/save_progress/, 1);
    const { device, team } = await freshTeam({ fetch: flaky });
    await device.submitDiagnostic(team.id, sub('20'));
    stats.lost = 0;
    const t = await device.saveProgress(team.id, { phase: 'hipotese' });
    expect(t.phase).toBe('hipotese');
  });

  it('sem conexão: depois das tentativas o erro é compreensível (NETWORK), o estado vira "Sem conexão" e a volta é automática', async () => {
    let down = false;
    const flaky: typeof fetch = async (input, init) => {
      if (down) throw new TypeError('fetch failed');
      return fetch(input, init);
    };
    const { device, team } = await freshTeam({ fetch: flaky, retries: 2, retryBaseMs: 10 });
    await device.submitDiagnostic(team.id, sub('20'));
    down = true;
    const err = await device.saveProgress(team.id, { phase: 'hipotese' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryError);
    expect((err as RepositoryError).code).toBe('NETWORK');
    expect((err as RepositoryError).message).toMatch(/Sem conexão/);
    expect(device.connection.get()).toBe('offline');
    down = false;
    const ok = await device.saveProgress(team.id, { phase: 'hipotese' });
    expect(ok.phase).toBe('hipotese');
    expect(device.connection.get()).toBe('connected');
  });

  it('erros de regra (não de rede) NÃO são repetidos: um único pedido ao servidor', async () => {
    const { flaky, stats } = loseFirstResponses(/rpc\/submit_exit/, 0);
    const { device, team } = await freshTeam({ fetch: flaky });
    expect(await codeOf(device.submitExit(team.id, sub('24')))).toBe('INVALID_STATE');
    expect(stats.calls).toBe(1);
  });
});

describe('apagar a sessão enquanto as equipes trabalham', () => {
  it('não causa deadlock: cada envio termina com sucesso ou com erro claro, e nada fica órfão', async () => {
    for (let round = 0; round < 4; round += 1) {
      const s = await teacher.openSession();
      const teams = await Promise.all(
        Array.from({ length: 12 }, async (_, i) => {
          const d = newDevice();
          const t = await d.joinSession(s.code, `Equipe Apagar ${i + 1}`);
          return { d, id: t.id };
        }),
      );
      const work = Promise.all(
        teams.map(async ({ d, id }) => {
          const out: string[] = [];
          for (const step of [
            () => d.submitDiagnostic(id, sub('20')),
            () => d.saveProgress(id, { phase: 'hipotese' }),
            () => d.recordHint(id, 1),
            () => d.submitHypothesis(id, sub('60')),
          ]) out.push(await codeOf(step()));
          return out;
        }),
      );
      await sleep(30); // apaga no meio do trabalho
      const del = codeOf(teacher.deleteSession(s.code));
      const [results, deleted] = await Promise.all([work, del]);
      expect(deleted).toBe('OK');
      for (const codes of results) {
        for (const c of codes) expect(['OK', 'TEAM_NOT_FOUND', 'SESSION_CLOSED', 'INVALID_STATE']).toContain(c); // nunca "ERRO: deadlock"
      }
      const left = await count(`select count(*)::int as n from public.teams where session_id not in (select id from public.sessions)`);
      expect(left).toBe(0);
      expect(await count(`select count(*)::int as n from public.submissions s where not exists (select 1 from public.sessions x where x.id = s.session_id)`)).toBe(0);
    }
    sessionCode = (await teacher.openSession()).code;
  });
});

describe('ordem de travas: apagar a sessão enquanto uma equipe grava (reprodução determinística, duas conexões)', () => {
  it('sem deadlock: o apagar espera a equipe terminar, e depois tudo some junto', async () => {
    const pg = (await import('pg')).default;
    const { ENV } = await import('./env');
    const connect = async () => {
      const c = new pg.Client({ host: ENV.dbHost, port: ENV.dbPort, user: 'postgres', password: ENV.dbPassword, database: 'postgres' });
      await c.connect();
      return c;
    };
    const s = await teacher.openSession();
    const device = newDevice();
    const team = await device.joinSession(s.code, 'Equipe Trava');
    const teacherId = await withDb(async (db) => (await db.query(`select id from auth.users where email = 'professor.a@teste.local'`)).rows[0].id as string);
    const studentId = await withDb(async (db) => (await db.query('select user_id from public.teams where id = $1', [team.id])).rows[0].user_id as string);
    const claims = (sub: string) => JSON.stringify({ sub, role: 'authenticated', is_anonymous: sub === studentId });

    const A = await connect(); // equipe gravando
    const B = await connect(); // professor apagando
    try {
      await A.query('begin');
      await A.query(`select set_config('request.jwt.claims', $1, true)`, [claims(studentId)]);
      await A.query('select (app_private.student_team($1)).id', [team.id]); // A trava a linha da equipe

      await B.query('begin');
      await B.query(`select set_config('request.jwt.claims', $1, true)`, [claims(teacherId)]);
      const del = B.query('select public.delete_session($1)', [s.code]).then(() => 'OK', (e: { code?: string }) => e.code ?? 'ERRO');
      await sleep(500); // B começa a apagar e precisa esperar a equipe de A

      // A continua o seu trabalho: grava o diagnóstico (precisa "enxergar" a sessão)
      const ins = await A.query(
        `insert into public.submissions (team_id, session_id, kind, major, minor, calculation, raw_answer, answer, unit, justification, correct)
         select id, session_id, 'diagnostico', 8, 5, '8 x 5 : 2', '20', 20, 'm²', 'Metade do produto.', true from public.teams where id = $1`,
        [team.id],
      ).then(() => 'OK', (e: { code?: string }) => e.code ?? 'ERRO');
      if (ins === 'OK') await A.query('commit');
      else await A.query('rollback');

      expect(ins, 'a gravação da equipe não pode ser abortada por deadlock').toBe('OK');
      expect(await del, 'o apagar não pode ser abortado por deadlock').toBe('OK');
      await B.query('commit');
    } finally {
      await A.end();
      await B.end();
    }
    expect(await count(`select count(*)::int as n from public.teams where id = $1`, [team.id])).toBe(0);
    expect(await count(`select count(*)::int as n from public.submissions where team_id = $1`, [team.id])).toBe(0);
    sessionCode = (await teacher.openSession()).code;
  });
});

describe('sessão encerrada no meio do trabalho', () => {
  it('o envio seguinte é recusado com mensagem clara e os dados já enviados continuam visíveis ao professor', async () => {
    const s = await teacher.openSession();
    const device = newDevice();
    const team = await device.joinSession(s.code, 'Equipe Fim');
    await device.submitDiagnostic(team.id, sub('20'));
    await teacher.closeSession(s.code);
    const err = await device.saveProgress(team.id, { phase: 'hipotese' }).catch((e: unknown) => e);
    expect((err as RepositoryError).code).toBe('SESSION_CLOSED');
    expect((err as RepositoryError).message).toMatch(/encerrada/);
    expect((await device.getTeam(team.id))!.sessionClosed).toBe(true);
    const seen = await teacher.listTeams(s.code);
    expect(seen[0].diagnostic?.answer).toBe(20);
    sessionCode = (await teacher.openSession()).code; // volta a ter uma sessão aberta para os demais testes
  });
});
