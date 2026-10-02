import { describe, expect, it } from 'vitest';
import { validateAlias } from '../src/data/demoRepository';
import { deriveStatus } from '../src/domain/status';
import { input, joined, makeRepo, toHypothesis } from './helpers';

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

describe('separação entre diagnóstico, tentativas e saída', () => {
  it('guarda cada tipo de registro em campo próprio', async () => {
    const { repo, team } = await joined();
    await repo.submitDiagnostic(team.id, input('40'));
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.recordHint(team.id, 1);
    await repo.submitAttempt(team.id, input('60'));
    await repo.saveProgress(team.id, { phase: 'exploracao' });
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.submitAttempt(team.id, input('30'));
    await repo.saveProgress(team.id, { phase: 'saida' });
    await repo.submitExit(team.id, input('24', 'm²', { calculation: '12 × 4 ÷ 2' }));

    const t = (await repo.getTeam(team.id))!;
    expect(t.diagnostic).toMatchObject({ major: 8, minor: 5, answer: 40, correct: false, patternId: 'produto_sem_metade' });
    expect(t.attempts).toHaveLength(2);
    expect(t.attempts[0]).toMatchObject({ n: 1, major: 10, minor: 6, answer: 60, hintLevel: 1, correct: false });
    expect(t.attempts[1]).toMatchObject({ n: 2, answer: 30, correct: true });
    expect(t.exit).toMatchObject({ major: 12, minor: 4, answer: 24, correct: true });
    expect(t.phase).toBe('concluido');
    expect(deriveStatus(t)).toBe('concluiu');
  });

  it('o diagnóstico é único e as respostas não se misturam', async () => {
    const { repo, team } = await joined();
    await repo.submitDiagnostic(team.id, input('20'));
    await expect(repo.submitDiagnostic(team.id, input('40'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await repo.getTeam(team.id))!.diagnostic?.answer).toBe(20);
  });

  it('a saída exige ter passado pela missão e só pode ser enviada uma vez', async () => {
    const { repo, team } = await joined();
    await repo.submitDiagnostic(team.id, input('20'));
    await expect(repo.submitExit(team.id, input('24'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(repo.saveProgress(team.id, { phase: 'saida' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.submitAttempt(team.id, input('30'));
    await repo.saveProgress(team.id, { phase: 'saida' });
    await repo.submitExit(team.id, input('24'));
    await expect(repo.submitExit(team.id, input('24'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('a tentativa usa as medidas guardadas da equipe e rejeita medidas inválidas', async () => {
    const { repo, team } = await joined();
    await repo.submitDiagnostic(team.id, input('20'));
    await expect(repo.saveProgress(team.id, { diagonals: { major: 4, minor: 10 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(repo.saveProgress(team.id, { diagonals: { major: 99, minor: 10 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await repo.saveProgress(team.id, { diagonals: { major: 12, minor: 5 } });
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.submitAttempt(team.id, input('30'));
    expect((await repo.getTeam(team.id))!.attempts[0]).toMatchObject({ major: 12, minor: 5, answer: 30, correct: true });
  });

  it('rejeita envio inválido sem gravar nada', async () => {
    const { repo, team } = await joined();
    await expect(repo.submitDiagnostic(team.id, input('abc'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(repo.submitDiagnostic(team.id, input('20', ''))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await repo.getTeam(team.id))!.diagnostic).toBeNull();
  });

  it('não permite tentativa antes de explorar nem fora da ordem', async () => {
    const { repo, team } = await joined();
    await expect(repo.submitAttempt(team.id, input('30'))).rejects.toMatchObject({ code: 'INVALID_STATE' });
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
    await repo.submitAttempt(team.id, input('36'));
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
