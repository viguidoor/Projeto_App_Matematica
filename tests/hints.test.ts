import { describe, expect, it } from 'vitest';
import { RepositoryError } from '../src/data/repository';
import { HINTS } from '../src/domain/mission';
import { deriveStatus, maxHintLevel } from '../src/domain/status';
import { input, joined, toHypothesis } from './helpers';

describe('conteúdo das dicas', () => {
  it('são três, progressivas, na ordem pedida', () => {
    expect(HINTS.map((h) => h.level)).toEqual([1, 2, 3]);
    expect(HINTS[0].title).toMatch(/diagonais/i);
    expect(HINTS[1].title + HINTS[1].text).toMatch(/retângulo/i);
    expect(HINTS[2].title).toMatch(/compar/i);
  });
  it('não trazem algarismos, fórmula pronta nem resultado', () => {
    for (const h of HINTS) {
      expect(h.text).not.toMatch(/\d/);
      expect(h.text).not.toMatch(/[×÷=*/]/);
      expect(h.text.toLowerCase()).not.toMatch(/metade|dividir|dividam|multipliq/);
    }
  });
});

describe('fluxo das dicas', () => {
  it('só ficam disponíveis depois do diagnóstico', async () => {
    const { repo, team } = await joined();
    await expect(repo.recordHint(team.id, 1)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('são liberadas em ordem e registradas uma única vez', async () => {
    const { repo, team } = await joined();
    await toHypothesis(repo, team.id);
    await expect(repo.recordHint(team.id, 2)).rejects.toBeInstanceOf(RepositoryError);
    await repo.recordHint(team.id, 1);
    await repo.recordHint(team.id, 1); // repetida: sem duplicar
    await repo.recordHint(team.id, 2);
    const t = (await repo.getTeam(team.id))!;
    expect(t.hints.map((h) => h.level)).toEqual([1, 2]);
    expect(maxHintLevel(t)).toBe(2);
    await expect(repo.recordHint(team.id, 4 as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('cada tentativa registra o nível de dica disponível naquele momento', async () => {
    const { repo, team } = await joined();
    await toHypothesis(repo, team.id);
    await repo.submitAttempt(team.id, input('60'));
    await repo.saveProgress(team.id, { phase: 'exploracao' });
    await repo.recordHint(team.id, 1);
    await repo.recordHint(team.id, 2);
    await repo.saveProgress(team.id, { phase: 'hipotese' });
    await repo.submitAttempt(team.id, input('30'));
    const t = (await repo.getTeam(team.id))!;
    expect(t.attempts.map((a) => a.hintLevel)).toEqual([0, 2]);
    expect(t.attempts.map((a) => a.correct)).toEqual([false, true]);
  });

  it('o status passa a "pediu dica" e depois "tentou"', async () => {
    const { repo, team } = await joined();
    await toHypothesis(repo, team.id);
    await repo.recordHint(team.id, 1);
    expect(deriveStatus((await repo.getTeam(team.id))!)).toBe('pediu_dica');
    await repo.submitAttempt(team.id, input('30'));
    expect(deriveStatus((await repo.getTeam(team.id))!)).toBe('tentou');
  });

  it('não existem dicas no problema final', async () => {
    const { repo, team } = await joined();
    await toHypothesis(repo, team.id);
    await repo.submitAttempt(team.id, input('30'));
    await repo.saveProgress(team.id, { phase: 'saida' });
    await expect(repo.recordHint(team.id, 1)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
