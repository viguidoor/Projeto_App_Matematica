export const MIN_DIAGONAL = 2;
export const MAX_DIAGONAL = 20;
export const DIAGONAL_STEP = 0.5;
export const MAX_ANSWER = 100000;

export type Validation = { ok: true; value: number } | { ok: false; message: string };

/**
 * Lê um número digitado em português do Brasil ("12,5") ou com ponto ("12.5").
 * Rejeita vazio, negativos, notação científica, separadores de milhar e texto.
 */
export function parseDecimal(raw: string): Validation {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'Digite um número.' };
  if (text.startsWith('-')) return { ok: false, message: 'Use um valor positivo.' };
  if (!/^\d+([.,]\d+)?$/.test(text)) {
    return { ok: false, message: 'Use apenas algarismos e, se precisar, uma vírgula (ex.: 12,5).' };
  }
  const value = Number(text.replace(',', '.'));
  if (!Number.isFinite(value)) return { ok: false, message: 'Digite um número válido.' };
  return { ok: true, value };
}

/** Valida o valor de uma diagonal dentro do intervalo permitido no momento. */
export function validateDiagonalText(raw: string, min: number, max: number, label: string): Validation {
  const parsed = parseDecimal(raw);
  if (!parsed.ok) return parsed;
  if (parsed.value < min || parsed.value > max) {
    return { ok: false, message: `A ${label} deve ficar entre ${formatNumber(min)} m e ${formatNumber(max)} m.` };
  }
  return parsed;
}

/** Retorna uma mensagem de erro, ou null se o par de diagonais é válido. */
export function validateDiagonalPair(major: number, minor: number): string | null {
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return 'As diagonais precisam ser números.';
  if (major < MIN_DIAGONAL || major > MAX_DIAGONAL || minor < MIN_DIAGONAL || minor > MAX_DIAGONAL) {
    return `As diagonais devem ficar entre ${MIN_DIAGONAL} m e ${MAX_DIAGONAL} m.`;
  }
  if (minor > major) return 'A diagonal menor não pode ser maior que a diagonal maior.';
  return null;
}

/** Área do losango: (D × d) ÷ 2. Lança RangeError se as medidas forem inválidas. */
export function rhombusArea(major: number, minor: number): number {
  if (!Number.isFinite(major) || !Number.isFinite(minor)) throw new RangeError('As diagonais precisam ser números finitos.');
  if (major <= 0 || minor <= 0) throw new RangeError('As diagonais precisam ser positivas.');
  if (minor > major) throw new RangeError('A diagonal menor não pode ser maior que a diagonal maior.');
  return Math.round(((major * minor) / 2) * 1e6) / 1e6;
}

export function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** Formata com vírgula decimal (pt-BR), no máximo 2 casas. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value);
}
