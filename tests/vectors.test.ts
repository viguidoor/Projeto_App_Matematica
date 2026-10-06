import { describe, expect, it } from 'vitest';
import { formatNumber } from '../src/domain/area';
import { evaluateAnswer } from '../src/domain/evaluate';
import { containsPersonalData } from '../src/domain/pii';
import { validateAlias } from '../src/data/demoRepository';
import vectors from './vectors/evaluate.json';

// Os mesmos vetores são verificados no SQL em tests-supabase/parity.test.ts.
describe('vetores compartilhados (lado TypeScript)', () => {
  it.each(vectors.evaluate)('evaluate $major×$minor, resposta $answer $unit', (v) => {
    expect(evaluateAnswer(v.major, v.minor, v.answer, v.unit as 'm' | 'm²')).toEqual({ correct: v.correct, patternId: v.pattern });
  });
  it.each(vectors.formatNumber)('formatNumber($value) = "$text"', (v) => {
    expect(formatNumber(v.value)).toBe(v.text);
  });
  it.each(vectors.dadosPessoais)('dado pessoal em "$text"? $pessoal', (v) => {
    expect(containsPersonalData(v.text)).toBe(v.pessoal);
  });
  it.each(vectors.apelidos)('apelido "$alias" válido? $valido', (v) => {
    expect(validateAlias(v.alias) === null).toBe(v.valido);
  });
});
