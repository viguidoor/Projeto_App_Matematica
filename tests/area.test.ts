import { describe, expect, it } from 'vitest';
import { formatNumber, parseDecimal, rhombusArea, validateDiagonalPair, validateDiagonalText } from '../src/domain/area';

describe('rhombusArea', () => {
  it('calcula (D × d) ÷ 2 nos exemplos da especificação', () => {
    expect(rhombusArea(10, 6)).toBe(30);
    expect(rhombusArea(12, 4)).toBe(24);
    expect(rhombusArea(8, 5)).toBe(20);
  });
  it('aceita medidas decimais e diagonais iguais', () => {
    expect(rhombusArea(7.5, 4)).toBe(15);
    expect(rhombusArea(6, 6)).toBe(18);
  });
  it.each([
    [0, 5], [5, 0], [-2, 4], [4, -2], [Number.NaN, 4], [4, Number.POSITIVE_INFINITY],
  ])('rejeita medidas inválidas (%s, %s)', (a, b) => {
    expect(() => rhombusArea(a, b)).toThrow(RangeError);
  });
  it('rejeita diagonal menor maior que a maior', () => {
    expect(() => rhombusArea(4, 10)).toThrow(/menor/);
  });
});

describe('parseDecimal (entrada em pt-BR)', () => {
  it('aceita vírgula e ponto', () => {
    expect(parseDecimal('12,5')).toEqual({ ok: true, value: 12.5 });
    expect(parseDecimal(' 12.5 ')).toEqual({ ok: true, value: 12.5 });
    expect(parseDecimal('30')).toEqual({ ok: true, value: 30 });
  });
  it.each(['', '   ', 'abc', '1e3', '1,2,3', '1.000,5', '12 m', '-5', '--1', '5,', ',5', '∞', 'NaN'])(
    'rejeita entrada inválida "%s" com mensagem compreensível',
    (raw) => {
      const r = parseDecimal(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(5);
    },
  );
});

describe('validação das diagonais', () => {
  it('respeita o intervalo dado', () => {
    expect(validateDiagonalText('10', 2, 20, 'diagonal maior').ok).toBe(true);
    const low = validateDiagonalText('1', 2, 20, 'diagonal maior');
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.message).toContain('entre 2 m e 20 m');
    expect(validateDiagonalText('21', 2, 20, 'diagonal maior').ok).toBe(false);
  });
  it('valida o par: menor não pode superar a maior', () => {
    expect(validateDiagonalPair(10, 6)).toBeNull();
    expect(validateDiagonalPair(6, 6)).toBeNull();
    expect(validateDiagonalPair(6, 10)).toMatch(/menor/);
    expect(validateDiagonalPair(30, 6)).toMatch(/entre/);
    expect(validateDiagonalPair(Number.NaN, 6)).toBeTruthy();
  });
  it('formata com vírgula decimal', () => {
    expect(formatNumber(12.5)).toBe('12,5');
    expect(formatNumber(30)).toBe('30');
  });
});
