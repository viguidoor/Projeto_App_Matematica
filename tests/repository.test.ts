import { describe, expect, it } from 'vitest';
import { validateAlias } from '../src/data/demoRepository';
import { deriveStatus } from '../src/domain/status';
import { input, joined, makeRepo, revise, toHypothesis, withHypothesis } from './helpers';

describe('sessão e entrada', () => {
  it('abre sessão com código temporário de 6 caracteres e aceita entrada', async () => {
    const { repo } = makeRepo();
    const s = await repo.openSession();
    expect(s.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(s.expiresAt).toBeGreaterThan(s.openedAt);
    const team = await repo.joinSession(s.code.toLowerCase(), '  Equipe   Ipê ');
    expect(team.alias).toBe('Equipe Ipê');
    expect(deriveStatus(team)).toBe('entrou');
  });
  it('recusa código errado, sessão encerrada e apelido repetido', async () => {
    const { repo } = makeRepo();
    const s = await repo.openSession();
    await expect(repo.joinSession('ZZZZZZ', 'Equipe A')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await repo.joinSession(s.code, 'Equipe A');
    await expect(repo.joinSession(s.code, 'equipe a')).rejects.toMatchObject({ code: 'ALIAS_TAKEN' });
    await repo.closeSession(s.code);
    await expect(repo.joinSession(s.code, 'Equipe B')).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
  });
  it('apelidos pseudônimos: recusa dados pessoais evidentes', () => {
    expect(validateAlias('Equipe Ipê')).toBeNull();
    expect(validateAlias('a')).toBeTruthy();
    expect(validateAlias('x'.repeat(25))).toBeTruthy();
    expect(validateAlias('fulano@email.com')).toBeTruthy();
    expect(validateAlias('Equipe 11987654321')).toBeTruthy();
    expect(validateAlias('<script>')).toBeTruthy();
  });
  it('encerrar a sessão bloqueia novos envios', async () => {
    const { repo, team, code } = await joined();
    await repo.closeSession(code);
    await expect(repo.submitDiagnostic(team.id, input('20'))).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
  });
  it('a equipe é recuperada pelo identificador (atualização de página)', async () => {
    const { repo, team } = await joined();
    await toHypothesis(repo, team.id);
    const again = await repo.getTeam(team.id);
    expect(again?.phase).toBe('hipotese');
    expect(again?.alias).toBe('Equipe Teste');
    expect(await repo.getTeam('inexistente')).toBeNull();
  });
});

describe('separação: diagnóstico → hipótese inicial → tentativas/revisões → saída', () => {
  it('guarda cada tipo de registro em campo próprio', async () => {
    const { repo, team } = await joined();
    await repo.submitDiagnostic(team.id, input('40'));
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.recordHint(team.id, 1);
    await repo.submitHypothesis(team.id, input('60'));
    await revise(repo, team.id, '30');
    await repo.saveProgress(team.id, { phase: 'saida' });
    await repo.submitExit(team.id, input('24', 'm²', { calculation: '12 × 4 ÷ 2' }));

    const t = (await repo.getTeam(team.id))!;
    expect(t.diagnostic).toMatchObject({ major: 8, minor: 5, answer: 40, correct: false, patternId: 'produto_sem_metade', hintLevel: 0 });
    expect(t.hypothesis).toMatchObject({ major: 10, minor: 6, answer: 60, hintLevel: 1, correct: false, patternId: 'produto_sem_metade' });
    expect(t.attempts).toHaveLength(1);
    expect(t.attempts[0]).toMatchObject({ n: 1, major: 10, minor: 6, answer: 30, hintLevel: 1, correct: true });
    expect(t.exit).toMatchObject({ major: 12, minor: 4, answer: 24, correct: true, hintLevel: 0 });
    expect(t.phase).toBe('concluido');
    expect(deriveStatus(t)).toBe('concluiu');
  });

  it('o diagnóstico e a hipótese inicial são únicos; as respostas não se misturam', async () => {
    const { repo, team } = await joined();
    await repo.submitDiagnostic(team.id, input('20'));
    await expect(repo.submitDiagnostic(team.id, input('40'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await repo.getTeam(team.id))!.diagnostic?.answer).toBe(20);
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.submitHypothesis(team.id, input('60'));
    await repo.saveProgress(team.id, { phase: 'exploracao' });
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await expect(repo.submitHypothesis(team.id, input('30'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await repo.getTeam(team.id))!.hypothesis?.answer).toBe(60);
  });

  it('a tentativa/revisão só existe depois da hipótese inicial', async () => {
    const { repo, team } = await joined();
    await toHypothesis(repo, team.id);
    await expect(repo.submitAttempt(team.id, input('30'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await repo.submitHypothesis(team.id, input('30'));
    expect((await repo.getTeam(team.id))!.attempts).toEqual([]);
  });

  it('a saída exige ter registrado a hipótese inicial e só pode ser enviada uma vez', async () => {
    const { repo, team } = await joined();
    await repo.submitDiagnostic(team.id, input('20'));
    await expect(repo.submitExit(team.id, input('24'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(repo.saveProgress(team.id, { phase: 'saida' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.submitHypothesis(team.id, input('30'));
    await repo.saveProgress(team.id, { phase: 'saida' });
    await repo.submitExit(team.id, input('24'));
    await expect(repo.submitExit(team.id, input('24'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('a hipótese usa as medidas guardadas da equipe e rejeita medidas inválidas', async () => {
    const { repo, team } = await joined();
    await repo.submitDiagnostic(team.id, input('20'));
    await expect(repo.saveProgress(team.id, { diagonals: { major: 4, minor: 10 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(repo.saveProgress(team.id, { diagonals: { major: 99, minor: 10 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await repo.saveProgress(team.id, { diagonals: { major: 12, minor: 5 } });
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.submitHypothesis(team.id, input('30'));
    expect((await repo.getTeam(team.id))!.hypothesis).toMatchObject({ major: 12, minor: 5, answer: 30, correct: true });
  });

  it('rejeita envio inválido sem gravar nada', async () => {
    const { repo, team } = await joined();
    await expect(repo.submitDiagnostic(team.id, input('abc'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(repo.submitDiagnostic(team.id, input('20', ''))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await repo.getTeam(team.id))!.diagnostic).toBeNull();
  });

  it('rejeita dado pessoal evidente nos textos livres (e-mail, telefone, números longos, endereço web)', async () => {
    const { repo, team } = await joined();
    for (const justification of ['escrevi para ana@escola.com agora', 'liguei 99999-1234 ontem', 'matrícula 20240123 aqui', 'vi em www.site.com.br hoje']) {
      await expect(repo.submitDiagnostic(team.id, input('20', 'm²', { justification }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    await expect(repo.submitDiagnostic(team.id, input('20', 'm²', { calculation: '8 x 5 : 2 = 20000' }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await repo.getTeam(team.id))!.diagnostic).toBeNull();
  });

  it('não permite hipótese antes de explorar nem fora da ordem', async () => {
    const { repo, team } = await joined();
    await expect(repo.submitHypothesis(team.id, input('30'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(repo.submitAttempt(team.id, input('30'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('é idempotente: repetir o mesmo requestId não duplica nem muda o registro', async () => {
    const { repo, team } = await joined();
    const req = '11111111-1111-4111-8111-111111111111';
    const a = await repo.submitDiagnostic(team.id, input('20', 'm²', { requestId: req }));
    const b = await repo.submitDiagnostic(team.id, input('20', 'm²', { requestId: req }));
    expect(b).toEqual(a);
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    const h1 = await repo.submitHypothesis(team.id, input('60', 'm²', { requestId: '22222222-2222-4222-8222-222222222222' }));
    const h2 = await repo.submitHypothesis(team.id, input('60', 'm²', { requestId: '22222222-2222-4222-8222-222222222222' }));
    expect(h2).toEqual(h1);
    await repo.saveProgress(team.id, { phase: 'exploracao' });
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    const r = '33333333-3333-4333-8333-333333333333';
    await repo.submitAttempt(team.id, input('30', 'm²', { requestId: r }));
    await repo.submitAttempt(team.id, input('30', 'm²', { requestId: r }));
    expect((await repo.getTeam(team.id))!.attempts).toHaveLength(1);
  });
});

describe('estado exibido ao professor', () => {
  it('percorre entrou → fez diagnóstico → explorando → pediu dica → tentou → concluiu', async () => {
    const { repo, team } = await joined();
    const st = async () => deriveStatus((await repo.getTeam(team.id))!);
    expect(await st()).toBe('entrou');
    await repo.submitDiagnostic(team.id, input('20'));
    expect(await st()).toBe('fez_diagnostico');
    await repo.saveProgress(team.id, { diagonals: { major: 12, minor: 6 } });
    expect(await st()).toBe('explorando');
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.recordHint(team.id, 1);
    expect(await st()).toBe('pediu_dica');
    await repo.submitHypothesis(team.id, input('36'));
    expect(await st()).toBe('tentou');
    await repo.saveProgress(team.id, { phase: 'saida' });
    await repo.submitExit(team.id, input('24'));
    expect(await st()).toBe('concluiu');
  });
});

describe('notas, projeção e equipes fictícias', () => {
  it('registra dificuldade → intervenção → resposta e recusa nota vazia', async () => {
    const { repo, code } = await joined();
    await expect(repo.addNote(code, { team: null, difficulty: ' ', intervention: '', response: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await repo.addNote(code, { team: 'Equipe Teste', difficulty: 'Esqueceram ÷2', intervention: 'Relacionar com o retângulo', response: 'Corrigiram' });
    const notes = await repo.listNotes(code);
    expect(notes).toHaveLength(1);
    expect(notes[0].intervention).toContain('retângulo');
  });
  it('equipes fictícias são marcadas, usam as regras reais e podem ser removidas', async () => {
    const { repo, team, code } = await joined();
    await repo.seedFictitiousTeams!(code);
    const all = await repo.listTeams(code);
    const fake = all.filter((t) => t.fictitious);
    expect(fake.length).toBeGreaterThanOrEqual(5);
    expect(fake.every((t) => t.alias.startsWith('Fictícia'))).toBe(true);
    expect(new Set(fake.map((t) => deriveStatus(t))).size).toBeGreaterThanOrEqual(5);
    await repo.removeFictitiousTeams!(code);
    const rest = await repo.listTeams(code);
    expect(rest.map((t) => t.id)).toEqual([team.id]);
  });
  it('apagar a sessão remove equipes, respostas e notas', async () => {
    const { repo, team, code } = await joined();
    await withHypothesis(repo, team.id);
    await repo.addNote(code, { team: null, difficulty: 'x', intervention: '', response: '' });
    await repo.deleteSession(code);
    expect(await repo.getCurrentSession()).toBeNull();
    expect(await repo.listTeams(code)).toEqual([]);
    expect(await repo.listNotes(code)).toEqual([]);
    expect(await repo.getTeam(team.id)).toBeNull();
  });
  it('a visão de projeção só tem dados agregados ou exemplo revisado, nunca apelidos', async () => {
    const { repo, code } = await joined();
    await repo.seedFictitiousTeams!(code);
    expect(await repo.getProjectionView(code)).toEqual({ kind: 'none' });
    await repo.setProjection({ kind: 'distribution', stage: 'hipotese', showCorrect: false });
    const view = await repo.getProjectionView(code);
    expect(view.kind).toBe('distribution');
    expect(JSON.stringify(view)).not.toMatch(/Fictícia|Equipe Teste/);
    expect(await repo.getProjectionView('ZZZZZZ')).toEqual({ kind: 'none' });
  });
  it('notifica assinantes a cada mudança', async () => {
    const { repo, team } = await joined();
    let calls = 0;
    const off = repo.subscribe(() => (calls += 1));
    await repo.submitDiagnostic(team.id, input('20'));
    off();
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    expect(calls).toBe(1);
  });
});
