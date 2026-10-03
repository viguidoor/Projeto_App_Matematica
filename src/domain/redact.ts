/**
 * Apoio à revisão de textos antes da projeção. A detecção é uma SUGESTÃO inicial: não garante
 * que todo dado pessoal foi encontrado. Quem decide o que a turma verá é o professor.
 */
export type PiiReason = 'email' | 'telefone' | 'numero_longo' | 'endereco_web' | 'nome_da_equipe' | 'possivel_nome';

export const PII_LABEL: Record<PiiReason, string> = {
  email: 'e-mail',
  telefone: 'telefone',
  numero_longo: 'número longo',
  endereco_web: 'endereço da internet',
  nome_da_equipe: 'nome da equipe',
  possivel_nome: 'possível nome',
};

export interface Token {
  text: string;
  /** Falso para espaços e quebras de linha. */
  isWord: boolean;
  /** Motivo da ocultação sugerida (null = nada suspeito). */
  reason: PiiReason | null;
}

export const HIDDEN_MARK = '[oculto]';

const STOP_WORDS = new Set(['equipe', 'ficticia', 'time', 'grupo']);
/** Palavras da matemática da missão que costumam vir com maiúscula e não são nomes. */
const MATH_WORDS = new Set(['losango', 'diagonal', 'diagonais', 'jardim', 'area', 'retangulo', 'quadrado', 'triangulo', 'metro', 'metros']);

export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

/** Palavras dos apelidos de equipe (>= 3 letras), para ocultar se aparecerem no texto. */
export function aliasWords(aliases: readonly string[]): string[] {
  const words = new Set<string>();
  for (const alias of aliases) {
    for (const w of alias.split(/\s+/)) {
      const f = fold(w.replace(/[^\p{L}\p{N}]/gu, ''));
      if (f.length >= 3 && !STOP_WORDS.has(f)) words.add(f);
    }
  }
  return [...words];
}

const core = (word: string) => word.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}]+$/gu, '');

export function tokenize(text: string, knownWords: readonly string[] = []): Token[] {
  const known = new Set(knownWords.map(fold));
  const parts = text.split(/(\s+)/).filter((p) => p !== '');
  let previousWord: string | null = null;

  return parts.map((part) => {
    if (/^\s+$/.test(part)) return { text: part, isWord: false, reason: null };

    const c = core(part);
    let reason: PiiReason | null = null;
    const digits = part.replace(/\D/g, '');

    if (part.includes('@')) reason = 'email';
    else if (/^(https?:|www\.)/i.test(part) || /\.(com|net|org|br)\b/i.test(part)) reason = 'endereco_web';
    else if (digits.length >= 8) reason = 'telefone';
    else if (/\d{4,}/.test(part)) reason = 'numero_longo';
    else if (c && known.has(fold(c))) reason = 'nome_da_equipe';
    else if (
      previousWord !== null &&
      !/[.!?:;]$/.test(previousWord) &&
      /^\p{Lu}\p{Ll}{2,}$/u.test(c) &&
      !MATH_WORDS.has(fold(c))
    ) {
      reason = 'possivel_nome';
    }

    previousWord = part;
    return { text: part, isWord: true, reason };
  });
}

/** Estado inicial da revisão: oculta tudo que foi sinalizado. */
export function initialHidden(tokens: readonly Token[]): boolean[] {
  return tokens.map((t) => t.reason !== null);
}

/** Texto final, com cada palavra oculta trocada por "[oculto]". */
export function applyHidden(tokens: readonly Token[], hidden: readonly boolean[]): string {
  return tokens
    .map((t, i) => (t.isWord && hidden[i] ? HIDDEN_MARK : t.text))
    .join('')
    .trim();
}
