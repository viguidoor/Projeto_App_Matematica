import { describe, expect, it } from 'vitest';
import { evaluateAnswer, PATTERNS, validateSubmissionInput } from '../src/domain/evaluate';

describe('avaliação e padrões (hipóteses pedagógicas)', () => {
  it('10 m × 6 m: 30 m² está correto', () => {
    expect(evaluateAnswer(10, 6, 30, 'm²')).toEqual({ correct: true, patternId: null });
  });
  it('60 m² em 10 × 6 sinaliza possível omissão da divisão por 2', () => {
    const r = evaluateAnswer(10, 6, 60, 'm²');
    expect(r).toEqual({ correct: false, patternId: 'produto_sem_metade' });
    expect(PATTERNS.produto_sem_metade.teacherHypothesis).toMatch(/possível omissão da divisão por 2/);
  });
  it('soma, média e quarto do produto', () => {
    expect(evaluateAnswer(10, 6, 16, 'm²').patternId).toBe('soma_diagonais');
    expect(evaluateAnswer(10, 6, 8, 'm²').patternId).toBe('media_diagonais');
    expect(evaluateAnswer(10, 6, 15, 'm²').patternId).toBe('quarto_do_produto');
  });
  it('número certo com unidade de comprimento não é correto e indica unidade', () => {
    expect(evaluateAnswer(10, 6, 30, 'm')).toEqual({ correct: false, patternId: 'unidade_incorreta' });
  });
  it('resposta sem padrão conhecido não recebe rótulo', () => {
    expect(evaluateAnswer(10, 6, 31, 'm²')).toEqual({ correct: false, patternId: null });
  });
  it('rótulos para o professor são hipóteses; devolutiva ao estudante não entrega a resposta', () => {
    for (const p of Object.values(PATTERNS)) {
      expect(p.teacherHypothesis).toMatch(/possível|coincide|indício|está de acordo/i);
      expect(p.studentFeedback).not.toMatch(/\d/);
    }
  });
  it('o problema de saída 12 × 4 segue a mesma lógica', () => {
    expect(evaluateAnswer(12, 4, 24, 'm²').correct).toBe(true);
    expect(evaluateAnswer(12, 4, 48, 'm²').patternId).toBe('produto_sem_metade');
  });
});

describe('validação do envio', () => {
  const ok = { calculation: '10 × 6 ÷ 2', rawAnswer: '30', unit: 'm²' as const, justification: 'Metade do retângulo.' };
  it('aceita um envio completo', () => {
    expect(validateSubmissionInput(ok).ok).toBe(true);
  });
  it('exige cálculo, número, unidade e justificativa', () => {
    const r = validateSubmissionInput({ calculation: '', rawAnswer: '', unit: '', justification: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['calculation', 'justification', 'rawAnswer', 'unit']);
  });
  it.each(['abc', '-3', '0', '1e5', '1000000'])('rejeita área inválida "%s"', (rawAnswer) => {
    const r = validateSubmissionInput({ ...ok, rawAnswer });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rawAnswer).toBeTruthy();
  });
  it('aceita vírgula decimal', () => {
    const r = validateSubmissionInput({ ...ok, rawAnswer: '12,5' });
    expect(r.ok && r.value.answer).toBe(12.5);
  });
});
