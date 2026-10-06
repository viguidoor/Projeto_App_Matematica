import { describe, expect, it } from 'vitest';
import { RepositoryError, type SessionRepository } from '../../src/data/repository';
import { deriveStatus } from '../../src/domain/status';
import type { Session, SubmissionInput, TeamRecord } from '../../src/domain/types';
import vectors from '../vectors/evaluate.json';

/**
 * Teste de CONTRATO: as duas implementações de SessionRepository (DemoRepository e SupabaseRepository)
 * devem ter o MESMO comportamento observável. Este arquivo é executado contra as duas.
 */
export interface World {
  /** Repositório do professor (já autenticado, se for o caso). */
  teacher: SessionRepository;
  /** Um dispositivo novo de estudante (no modo DEMONSTRAÇÃO todos compartilham o mesmo navegador). */
  newStudent(): SessionRepository;
  /** Simula atualizar a página: mesmo dispositivo, nova instância do repositório. */
  reload(student: SessionRepository): SessionRepository;
}
export type WorldFactory = () => Promise<World>;

const input = (rawAnswer: string, unit: 'm' | 'm²' | '' = 'm²', extra: Partial<SubmissionInput> = {}): SubmissionInput => ({
  calculation: '10 × 6 ÷ 2',
  rawAnswer,
  unit,
  justification: 'Multiplicamos as diagonais e dividimos.',
  ...extra,
});

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

async function start(world: World, alias = 'Equipe Ipê') {
  const session = await world.teacher.openSession();
  const student = world.newStudent();
  const team = await student.joinSession(session.code, alias);
  return { session, student, team };
}

async function rejects(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `esperava RepositoryError ${code}`).toBeInstanceOf(RepositoryError);
  expect((err as RepositoryError).code).toBe(code);
}

/** Leva a equipe até o formulário da hipótese inicial. */
async function toHypothesisForm(student: SessionRepository, teamId: string, diagnostic = '20') {
  await student.submitDiagnostic(teamId, input(diagnostic));
  await student.saveProgress(teamId, { phase: 'hipotese' });
}

async function revise(student: SessionRepository, teamId: string, answer: string) {
  await student.saveProgress(teamId, { phase: 'exploracao' });
  await student.saveProgress(teamId, { phase: 'hipotese' });
  return student.submitAttempt(teamId, input(answer));
}

export function defineContract(name: string, makeWorld: WorldFactory) {
  describe(`contrato do repositório: ${name}`, () => {
    it('abre sessão com código temporário e a equipe entra (apelido normalizado)', async () => {
      const w = await makeWorld();
      const session = await w.teacher.openSession();
      expect(session.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(session.expiresAt).toBeGreaterThan(session.openedAt);
      expect(session.closedAt).toBeNull();
      const team = await w.newStudent().joinSession(session.code.toLowerCase(), '  Equipe   Ipê ');
      expect(team.alias).toBe('Equipe Ipê');
      expect(team.phase).toBe('diagnostico');
      expect(team.diagnostic).toBeNull();
      expect(team.hypothesis).toBeNull();
      expect(team.attempts).toEqual([]);
      expect(team.exit).toBeNull();
      expect(deriveStatus(team)).toBe('entrou');
      const current = await w.teacher.getCurrentSession();
      expect(current?.code).toBe(session.code);
    });

    it('recusa código errado, sessão encerrada e apelido repetido (sem diferenciar maiúsculas)', async () => {
      const w = await makeWorld();
      const s = await w.teacher.openSession();
      await rejects(w.newStudent().joinSession('ZZZZZZ', 'Equipe A'), 'SESSION_NOT_FOUND');
      await w.newStudent().joinSession(s.code, 'Equipe A');
      await rejects(w.newStudent().joinSession(s.code, 'equipe a'), 'ALIAS_TAKEN');
      await w.teacher.closeSession(s.code);
      await rejects(w.newStudent().joinSession(s.code, 'Equipe B'), 'SESSION_CLOSED');
    });

    it('valida apelidos: aceita nomes de equipe e recusa dados pessoais evidentes', async () => {
      const w = await makeWorld();
      const s = await w.teacher.openSession();
      for (const v of vectors.apelidos) {
        const attempt = w.newStudent().joinSession(s.code, v.alias);
        if (v.valido) {
          const team = await attempt;
          expect(team.alias, v.alias).toBe(v.alias);
        } else {
          await rejects(attempt, 'ALIAS_INVALID');
        }
      }
    });

    it('encerrar a sessão bloqueia novos envios e a equipe é avisada', async () => {
      const w = await makeWorld();
      const { session, student, team } = await start(w);
      expect((await student.getTeam(team.id))?.sessionClosed).toBe(false);
      await w.teacher.closeSession(session.code);
      await rejects(student.submitDiagnostic(team.id, input('20')), 'SESSION_CLOSED');
      await rejects(student.saveProgress(team.id, { phase: 'hipotese' }), 'SESSION_CLOSED');
      expect((await student.getTeam(team.id))?.sessionClosed).toBe(true);
      expect((await w.teacher.getCurrentSession())?.closedAt).not.toBeNull();
    });

    it('a equipe é recuperada depois de atualizar a página, em qualquer fase', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      let device = student;
      const phaseAfterReload = async () => {
        device = w.reload(device);
        return device.getTeam(team.id);
      };
      expect((await phaseAfterReload())?.phase).toBe('diagnostico');
      await device.submitDiagnostic(team.id, input('40'));
      expect((await phaseAfterReload())?.diagnostic?.answer).toBe(40);
      await device.saveProgress(team.id, { diagonals: { major: 12, minor: 6 } });
      await device.saveProgress(team.id, { phase: 'hipotese' });
      const t1 = await phaseAfterReload();
      expect(t1?.phase).toBe('hipotese');
      expect(t1?.diagonals).toEqual({ major: 12, minor: 6 });
      await device.recordHint(team.id, 1);
      await device.submitHypothesis(team.id, input('72'));
      const t2 = await phaseAfterReload();
      expect(t2?.phase).toBe('feedback');
      expect(t2?.hypothesis?.answer).toBe(72);
      expect(t2?.hints.map((h) => h.level)).toEqual([1]);
      await revise(device, team.id, '36');
      await device.saveProgress(team.id, { phase: 'saida' });
      expect((await phaseAfterReload())?.phase).toBe('saida');
      await device.submitExit(team.id, input('24'));
      const t3 = await phaseAfterReload();
      expect(t3?.phase).toBe('concluido');
      expect(t3?.exit?.correct).toBe(true);
    });

    it('guarda diagnóstico → hipótese inicial → tentativas/revisões → saída, cada um em campo próprio', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      await student.submitDiagnostic(team.id, input('40'));
      await student.saveProgress(team.id, { phase: 'hipotese' });
      await student.recordHint(team.id, 1);
      await student.submitHypothesis(team.id, input('60'));
      await revise(student, team.id, '30');
      await student.saveProgress(team.id, { phase: 'saida' });
      await student.submitExit(team.id, input('24', 'm²', { calculation: '12 × 4 ÷ 2' }));

      const t = (await student.getTeam(team.id))!;
      expect(t.diagnostic).toMatchObject({ major: 8, minor: 5, answer: 40, correct: false, patternId: 'produto_sem_metade', hintLevel: 0 });
      expect(t.hypothesis).toMatchObject({ major: 10, minor: 6, answer: 60, correct: false, patternId: 'produto_sem_metade', hintLevel: 1 });
      expect(t.attempts).toHaveLength(1);
      expect(t.attempts[0]).toMatchObject({ n: 1, major: 10, minor: 6, answer: 30, correct: true, patternId: null, hintLevel: 1 });
      expect(t.exit).toMatchObject({ major: 12, minor: 4, answer: 24, correct: true, hintLevel: 0 });
      expect(t.phase).toBe('concluido');
      expect(deriveStatus(t)).toBe('concluiu');
      // o professor vê exatamente o mesmo
      const [seen] = await w.teacher.listTeams((await w.teacher.getCurrentSession())!.code);
      expect(seen.diagnostic?.answer).toBe(40);
      expect(seen.hypothesis?.answer).toBe(60);
      expect(seen.attempts.map((a) => a.answer)).toEqual([30]);
      expect(seen.exit?.answer).toBe(24);
    });

    it('diagnóstico e hipótese inicial são únicos; revisão só depois da hipótese; saída só depois', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      await rejects(student.submitHypothesis(team.id, input('30')), 'INVALID_STATE'); // sem diagnóstico
      await student.submitDiagnostic(team.id, input('20'));
      await rejects(student.submitDiagnostic(team.id, input('40')), 'INVALID_STATE');
      await rejects(student.submitHypothesis(team.id, input('30')), 'INVALID_STATE'); // ainda explorando
      await rejects(student.submitAttempt(team.id, input('30')), 'INVALID_STATE'); // revisão antes da hipótese
      await rejects(student.saveProgress(team.id, { phase: 'saida' }), 'INVALID_STATE');
      await rejects(student.submitExit(team.id, input('24')), 'INVALID_STATE');
      await student.saveProgress(team.id, { phase: 'hipotese' });
      await rejects(student.submitAttempt(team.id, input('30')), 'INVALID_STATE'); // formulário é da hipótese
      await student.submitHypothesis(team.id, input('60'));
      await student.saveProgress(team.id, { phase: 'exploracao' });
      await student.saveProgress(team.id, { phase: 'hipotese' });
      await rejects(student.submitHypothesis(team.id, input('30')), 'INVALID_STATE'); // hipótese inicial é uma só
      expect((await student.getTeam(team.id))!.hypothesis?.answer).toBe(60);
      expect((await student.getTeam(team.id))!.diagnostic?.answer).toBe(20);
    });

    it('a saída exige a hipótese inicial e só pode ser enviada uma vez', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      await toHypothesisForm(student, team.id);
      await student.submitHypothesis(team.id, input('30'));
      await student.saveProgress(team.id, { phase: 'saida' }); // pode ir à saída sem revisões
      await student.submitExit(team.id, input('24'));
      await rejects(student.submitExit(team.id, input('24')), 'INVALID_STATE');
      await rejects(student.saveProgress(team.id, { phase: 'exploracao' }), 'INVALID_STATE');
    });

    it('dicas: só depois do diagnóstico, em ordem, sem repetir, e não existem na saída', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      await rejects(student.recordHint(team.id, 1), 'INVALID_STATE'); // antes do diagnóstico
      await toHypothesisForm(student, team.id);
      await rejects(student.recordHint(team.id, 2), 'INVALID_STATE'); // pulou a 1
      await rejects(student.recordHint(team.id, 4 as never), 'INVALID_INPUT');
      await student.recordHint(team.id, 1);
      await student.recordHint(team.id, 1); // repetida: não duplica
      await student.recordHint(team.id, 2);
      let t = (await student.getTeam(team.id))!;
      expect(t.hints.map((h) => h.level)).toEqual([1, 2]);
      expect(deriveStatus(t)).toBe('pediu_dica');
      await student.submitHypothesis(team.id, input('30'));
      await student.saveProgress(team.id, { phase: 'saida' });
      await rejects(student.recordHint(team.id, 3), 'INVALID_STATE');
      await student.submitExit(team.id, input('24'));
      t = (await student.getTeam(team.id))!;
      expect(t.hints.map((h) => h.level)).toEqual([1, 2]);
      expect(t.exit?.hintLevel).toBe(0);
    });

    it('cada tentativa guarda o maior nível de dica visto naquele momento', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      await toHypothesisForm(student, team.id);
      await student.submitHypothesis(team.id, input('60')); // sem dicas
      await revise(student, team.id, '16'); // ainda sem dicas
      await student.recordHint(team.id, 1);
      await student.recordHint(team.id, 2);
      await revise(student, team.id, '30');
      const t = (await student.getTeam(team.id))!;
      expect(t.hypothesis?.hintLevel).toBe(0);
      expect(t.attempts.map((a) => [a.n, a.answer, a.hintLevel, a.patternId])).toEqual([
        [1, 16, 0, 'soma_diagonais'],
        [2, 30, 2, null],
      ]);
    });

    it('medidas: valida limites, só mudam na exploração, D = d é permitido e repetir a fase é inócuo', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      await rejects(student.saveProgress(team.id, { diagonals: { major: 12, minor: 5 } }), 'INVALID_STATE'); // ainda no diagnóstico
      await student.submitDiagnostic(team.id, input('20'));
      await rejects(student.saveProgress(team.id, { diagonals: { major: 4, minor: 10 } }), 'INVALID_INPUT'); // menor > maior
      await rejects(student.saveProgress(team.id, { diagonals: { major: 99, minor: 10 } }), 'INVALID_INPUT');
      await rejects(student.saveProgress(team.id, { diagonals: { major: 10, minor: 1 } }), 'INVALID_INPUT');
      const t0 = await student.saveProgress(team.id, { diagonals: { major: 10, minor: 10 } }); // quadrado
      expect(t0.diagonals).toEqual({ major: 10, minor: 10 });
      expect(t0.exploringSince).not.toBeNull();
      await student.saveProgress(team.id, { phase: 'hipotese' });
      await student.saveProgress(team.id, { phase: 'hipotese' }); // repetição do mesmo pedido: sem efeito
      await rejects(student.saveProgress(team.id, { diagonals: { major: 12, minor: 6 } }), 'INVALID_STATE'); // fora da exploração
      await student.submitHypothesis(team.id, input('50'));
      expect((await student.getTeam(team.id))!.hypothesis).toMatchObject({ major: 10, minor: 10, answer: 50, correct: true });
    });

    it('rejeita envio inválido sem gravar nada e recusa dado pessoal evidente', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      await rejects(student.submitDiagnostic(team.id, input('abc')), 'INVALID_INPUT');
      await rejects(student.submitDiagnostic(team.id, input('-5')), 'INVALID_INPUT');
      await rejects(student.submitDiagnostic(team.id, input('0')), 'INVALID_INPUT');
      await rejects(student.submitDiagnostic(team.id, input('20', '')), 'INVALID_INPUT');
      await rejects(student.submitDiagnostic(team.id, input('20', 'm²', { calculation: '' })), 'INVALID_INPUT');
      await rejects(student.submitDiagnostic(team.id, input('20', 'm²', { justification: 'curta' })), 'INVALID_INPUT');
      for (const v of vectors.dadosPessoais.filter((d) => d.pessoal)) {
        await rejects(student.submitDiagnostic(team.id, input('20', 'm²', { justification: `justificativa: ${v.text}` })), 'INVALID_INPUT');
      }
      for (const v of vectors.dadosPessoais.filter((d) => !d.pessoal && d.text.length >= 8)) {
        const ok = await student.submitDiagnostic(team.id, input('20', 'm²', { justification: v.text, requestId: uuid(1) }));
        expect(ok.answer).toBe(20);
        break;
      }
      expect((await student.getTeam(team.id))!.diagnostic).not.toBeNull();
    });

    it('é idempotente: repetir o mesmo requestId não duplica nem altera o registro', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      const a = await student.submitDiagnostic(team.id, input('20', 'm²', { requestId: uuid(1) }));
      const b = await student.submitDiagnostic(team.id, input('20', 'm²', { requestId: uuid(1) }));
      expect(b).toEqual(a);
      await student.saveProgress(team.id, { phase: 'hipotese' });
      const h1 = await student.submitHypothesis(team.id, input('60', 'm²', { requestId: uuid(2) }));
      const h2 = await student.submitHypothesis(team.id, input('60', 'm²', { requestId: uuid(2) }));
      expect(h2).toEqual(h1);
      await student.saveProgress(team.id, { phase: 'exploracao' });
      await student.saveProgress(team.id, { phase: 'hipotese' });
      await student.submitAttempt(team.id, input('30', 'm²', { requestId: uuid(3) }));
      await student.submitAttempt(team.id, input('30', 'm²', { requestId: uuid(3) }));
      const t = (await student.getTeam(team.id))!;
      expect(t.attempts).toHaveLength(1);
      expect(t.hypothesis?.answer).toBe(60);
    });

    it('o status do professor percorre entrou → fez diagnóstico → explorando → pediu dica → tentou → concluiu', async () => {
      const w = await makeWorld();
      const { student, team } = await start(w);
      const status = async () => deriveStatus((await student.getTeam(team.id))!);
      expect(await status()).toBe('entrou');
      await student.submitDiagnostic(team.id, input('20'));
      expect(await status()).toBe('fez_diagnostico');
      await student.saveProgress(team.id, { diagonals: { major: 12, minor: 6 } });
      expect(await status()).toBe('explorando');
      await student.saveProgress(team.id, { phase: 'hipotese' });
      await student.recordHint(team.id, 1);
      expect(await status()).toBe('pediu_dica');
      await student.submitHypothesis(team.id, input('36'));
      expect(await status()).toBe('tentou');
      await student.saveProgress(team.id, { phase: 'saida' });
      await student.submitExit(team.id, input('24'));
      expect(await status()).toBe('concluiu');
    });

    it('professor: lista as equipes em ordem de chegada e registra notas (dificuldade → intervenção → resposta)', async () => {
      const w = await makeWorld();
      const s = await w.teacher.openSession();
      const first = await w.newStudent().joinSession(s.code, 'Equipe A');
      await new Promise((r) => setTimeout(r, 20));
      await w.newStudent().joinSession(s.code, 'Equipe B');
      const teams = await w.teacher.listTeams(s.code);
      expect(teams.map((t) => t.alias)).toEqual(['Equipe A', 'Equipe B']);
      expect(teams[0].id).toBe(first.id);

      await rejects(w.teacher.addNote(s.code, { team: null, difficulty: ' ', intervention: '', response: '' }), 'INVALID_INPUT');
      const saved = await w.teacher.addNote(s.code, {
        team: 'Equipe A',
        difficulty: 'Esqueceram ÷2',
        intervention: 'Relacionar com o retângulo',
        response: 'Corrigiram',
      });
      expect(saved).toMatchObject({ team: 'Equipe A', difficulty: 'Esqueceram ÷2' });
      await w.teacher.addNote(s.code, { team: null, difficulty: 'Turma toda', intervention: '', response: '' });
      const notes = await w.teacher.listNotes(s.code);
      expect(notes.map((n) => n.team)).toEqual(['Equipe A', null]);
      expect(notes[0].intervention).toContain('retângulo');
    });

    it('projeção: distribuição agregada só com 3 ou mais equipes; grupos únicos viram "outras"; exemplo revisado', async () => {
      const w = await makeWorld();
      const s = await w.teacher.openSession();
      expect(await w.teacher.getProjectionView(s.code)).toEqual({ kind: 'none' });
      await w.teacher.setProjection({ kind: 'distribution', stage: 'diagnostico', showCorrect: true });
      expect(await w.teacher.getProjection()).toEqual({ kind: 'distribution', stage: 'diagnostico', showCorrect: true });

      const answers = ['40', '40', '20', '13'];
      for (const [i, a] of answers.entries()) {
        const repo = w.newStudent();
        const team = await repo.joinSession(s.code, `Equipe ${i + 1}`);
        await repo.submitDiagnostic(team.id, input(a));
        if (i === 1) {
          const view = await w.teacher.getProjectionView(s.code); // só 2 respostas
          expect(view.kind === 'distribution' && view.distribution).toMatchObject({ suppressed: true, total: 2, entries: [], others: 0 });
        }
      }
      const view = await w.teacher.getProjectionView(s.code);
      expect(view.kind).toBe('distribution');
      if (view.kind !== 'distribution') return;
      expect(view.showCorrect).toBe(true);
      expect(view.distribution).toEqual({
        stage: 'diagnostico',
        total: 4,
        suppressed: false,
        entries: [{ label: '40 m²', count: 2, correct: false }],
        others: 2,
      });
      expect(JSON.stringify(view)).not.toMatch(/Equipe/); // nenhum apelido na projeção

      await w.teacher.setProjection({
        kind: 'example',
        showCorrect: false,
        example: { stage: 'diagnostico', major: 8, minor: 5, calculation: '8 x 5', answerText: '40 m²', justification: 'Eu [oculto] multipliquei.', correct: false },
      });
      const ex = await w.teacher.getProjectionView(s.code);
      expect(ex).toMatchObject({ kind: 'example', showCorrect: false });
      expect(ex.kind === 'example' && ex.example.justification).toBe('Eu [oculto] multipliquei.');
      await w.teacher.setProjection({ kind: 'none' });
      expect(await w.teacher.getProjectionView(s.code)).toEqual({ kind: 'none' });
    });

    it('distribuição por etapa: hipótese inicial e primeira revisão são etapas separadas', async () => {
      const w = await makeWorld();
      const s = await w.teacher.openSession();
      for (const [i, a] of ['60', '60', '30'].entries()) {
        const repo = w.newStudent();
        const team = await repo.joinSession(s.code, `Equipe ${i + 1}`);
        await toHypothesisForm(repo, team.id);
        await repo.submitHypothesis(team.id, input(a));
        if (i === 0) await revise(repo, team.id, '30');
      }
      await w.teacher.setProjection({ kind: 'distribution', stage: 'hipotese', showCorrect: false });
      const hyp = await w.teacher.getProjectionView(s.code);
      expect(hyp.kind === 'distribution' && hyp.distribution.entries).toEqual([{ label: '60 m²', count: 2, correct: false }]);
      await w.teacher.setProjection({ kind: 'distribution', stage: 'tentativa', showCorrect: false });
      const rev = await w.teacher.getProjectionView(s.code);
      expect(rev.kind === 'distribution' && rev.distribution).toMatchObject({ total: 1, suppressed: true });
    });

    it('apagar a sessão remove equipes, respostas e notas', async () => {
      const w = await makeWorld();
      const { session, student, team } = await start(w);
      await toHypothesisForm(student, team.id);
      await student.submitHypothesis(team.id, input('30'));
      await w.teacher.addNote(session.code, { team: null, difficulty: 'x', intervention: '', response: '' });
      await w.teacher.deleteSession(session.code);
      expect(await w.teacher.getCurrentSession()).toBeNull();
      expect(await w.teacher.listTeams(session.code)).toEqual([]);
      expect(await w.teacher.listNotes(session.code)).toEqual([]);
      expect(await student.getTeam(team.id)).toBeNull();
    });

    it('equipe inexistente devolve null e abrir nova sessão encerra a anterior', async () => {
      const w = await makeWorld();
      const first: Session = await w.teacher.openSession();
      const student = w.newStudent();
      expect(await student.getTeam(uuid(9))).toBeNull();
      const team: TeamRecord = await student.joinSession(first.code, 'Equipe A');
      const second = await w.teacher.openSession();
      expect(second.code).not.toBe(first.code);
      await rejects(student.submitDiagnostic(team.id, input('20')), 'SESSION_CLOSED');
      await rejects(w.newStudent().joinSession(first.code, 'Equipe B'), 'SESSION_CLOSED');
    });
  });
}
