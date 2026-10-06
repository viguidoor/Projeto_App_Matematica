import { formatNumber } from './area';
import { maxHintLevel } from './status';
import type { DistributionView, PatternId, ProjectionStage, Submission, TeamRecord } from './types';

/** Abaixo disso, a distribuição não é exibida (evita identificar equipes em grupos pequenos). */
export const MIN_TEAMS_FOR_DISTRIBUTION = 3;

export function submissionForStage(team: TeamRecord, stage: ProjectionStage): Submission | null {
  if (stage === 'diagnostico') return team.diagnostic;
  if (stage === 'hipotese') return team.hypothesis;
  if (stage === 'saida') return team.exit;
  return team.attempts[0] ?? null;
}

export type DistributionEntry = DistributionView['entries'][number];
export type Distribution = DistributionView;

/** Distribuição agregada de respostas. Nunca inclui apelidos ou identificadores. */
export function buildDistribution(
  teams: readonly TeamRecord[],
  stage: ProjectionStage,
  minTotal = MIN_TEAMS_FOR_DISTRIBUTION,
): Distribution {
  const submissions = teams.map((t) => submissionForStage(t, stage)).filter((s): s is Submission => s !== null);
  if (submissions.length < minTotal) {
    return { stage, total: submissions.length, suppressed: true, entries: [], others: 0 };
  }
  const groups = new Map<string, DistributionEntry>();
  for (const s of submissions) {
    const label = `${formatNumber(s.answer)} ${s.unit}`;
    const entry = groups.get(label) ?? { label, count: 0, correct: true };
    entry.count += 1;
    entry.correct = entry.correct && s.correct; // o grupo só "confere" se todas as respostas dele conferem
    groups.set(label, entry);
  }
  const all = [...groups.values()];
  const entries = all.filter((e) => e.count >= 2).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
  const others = all.filter((e) => e.count < 2).reduce((sum, e) => sum + e.count, 0);
  return { stage, total: submissions.length, suppressed: false, entries, others };
}

export interface PatternCount {
  patternId: PatternId;
  count: number;
}

/** Contagem de padrões (hipóteses pedagógicas) em todos os registros. */
export function countPatterns(teams: readonly TeamRecord[]): PatternCount[] {
  const counts = new Map<PatternId, number>();
  for (const t of teams) {
    const all: Submission[] = [
      ...(t.diagnostic ? [t.diagnostic] : []),
      ...(t.hypothesis ? [t.hypothesis] : []),
      ...t.attempts,
      ...(t.exit ? [t.exit] : []),
    ];
    for (const s of all) if (s.patternId) counts.set(s.patternId, (counts.get(s.patternId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([patternId, count]) => ({ patternId, count })).sort((a, b) => b.count - a.count);
}

export interface AggregateExport {
  geradoEm: string;
  modo: 'DEMONSTRAÇÃO' | 'CONECTADO';
  avisoLimites: string;
  resumo: ExportSummary;
  linhas: ExportRow[];
}

export interface ExportSummary {
  equipes: number;
  diagnostico: { respondidas: number; corretas: number };
  hipoteseInicial: { respondidas: number; corretas: number };
  tentativas: { total: number; equipesComDicas: number; dicasPorNivel: Record<'1' | '2' | '3', number> };
  saida: { respondidas: number; corretas: number };
  diagnosticoParaSaida: {
    ambasCorretas: number;
    diagnosticoErradoSaidaCerta: number;
    diagnosticoCertoSaidaErrada: number;
    ambasErradas: number;
  };
  /** Contagem por trajetória: diagnóstico → hipótese inicial → revisões → saída. Só números agregados. */
  trajetorias: Record<string, number>;
}

export interface ExportRow {
  equipe_anonima: string;
  ficticia: 'sim' | 'nao';
  diagnostico_correto: '' | 'sim' | 'nao';
  diagnostico_padrao: string;
  hipotese_correta: '' | 'sim' | 'nao';
  hipotese_padrao: string;
  hipotese_dica_nivel: number;
  revisoes: number;
  revisoes_com_dicas: number;
  dica_maxima: number;
  acertou_apos_revisao: 'sim' | 'nao';
  saida_correta: '' | 'sim' | 'nao';
  saida_padrao: string;
}

const yn = (v: boolean) => (v ? 'sim' : 'nao');
const verdict = (s: Submission | null) => (s ? (s.correct ? 'certo' : 'errado') : '-');

/** Chave da trajetória, ex.: "diag=errado;hip=errado;rev=2;saida=certo". */
export function trajectoryKey(t: TeamRecord): string {
  return `diag=${verdict(t.diagnostic)};hip=${verdict(t.hypothesis)};rev=${t.attempts.length};saida=${verdict(t.exit)}`;
}

export function buildExportRows(teams: readonly TeamRecord[]): ExportRow[] {
  const ordered = [...teams].sort((a, b) => (a.id < b.id ? -1 : 1));
  return ordered.map((t, i) => ({
    equipe_anonima: `E${String(i + 1).padStart(2, '0')}`,
    ficticia: t.fictitious ? 'sim' : 'nao',
    diagnostico_correto: t.diagnostic ? yn(t.diagnostic.correct) : '',
    diagnostico_padrao: t.diagnostic?.patternId ?? '',
    hipotese_correta: t.hypothesis ? yn(t.hypothesis.correct) : '',
    hipotese_padrao: t.hypothesis?.patternId ?? '',
    hipotese_dica_nivel: t.hypothesis?.hintLevel ?? 0,
    revisoes: t.attempts.length,
    revisoes_com_dicas: t.attempts.filter((a) => a.hintLevel > 0).length,
    dica_maxima: maxHintLevel(t),
    acertou_apos_revisao: yn(t.attempts.some((a) => a.correct)),
    saida_correta: t.exit ? yn(t.exit.correct) : '',
    saida_padrao: t.exit?.patternId ?? '',
  }));
}

export function buildExportSummary(teams: readonly TeamRecord[]): ExportSummary {
  const withDiag = teams.filter((t) => t.diagnostic);
  const withHyp = teams.filter((t) => t.hypothesis);
  const withExit = teams.filter((t) => t.exit);
  const both = teams.filter((t) => t.diagnostic && t.exit);
  const hintCount = (level: number) => teams.filter((t) => maxHintLevel(t) >= level).length;
  const trajetorias: Record<string, number> = {};
  for (const t of teams) {
    const k = trajectoryKey(t);
    trajetorias[k] = (trajetorias[k] ?? 0) + 1;
  }
  return {
    equipes: teams.length,
    diagnostico: { respondidas: withDiag.length, corretas: withDiag.filter((t) => t.diagnostic!.correct).length },
    hipoteseInicial: { respondidas: withHyp.length, corretas: withHyp.filter((t) => t.hypothesis!.correct).length },
    tentativas: {
      total: teams.reduce((n, t) => n + t.attempts.length, 0),
      equipesComDicas: teams.filter((t) => maxHintLevel(t) > 0).length,
      dicasPorNivel: { '1': hintCount(1), '2': hintCount(2), '3': hintCount(3) },
    },
    saida: { respondidas: withExit.length, corretas: withExit.filter((t) => t.exit!.correct).length },
    diagnosticoParaSaida: {
      ambasCorretas: both.filter((t) => t.diagnostic!.correct && t.exit!.correct).length,
      diagnosticoErradoSaidaCerta: both.filter((t) => !t.diagnostic!.correct && t.exit!.correct).length,
      diagnosticoCertoSaidaErrada: both.filter((t) => t.diagnostic!.correct && !t.exit!.correct).length,
      ambasErradas: both.filter((t) => !t.diagnostic!.correct && !t.exit!.correct).length,
    },
    trajetorias,
  };
}

export const EXPORT_LIMITS_NOTICE =
  'Dados de uma única turma e de um único momento. A comparação entre diagnóstico e saída não permite atribuir a diferença ao jogo: ela depende também da mediação, do tempo e de outros fatores. Em DEMONSTRAÇÃO, os dados são fictícios. O arquivo não contém apelidos, textos livres, horários nem identificadores.';

/**
 * Exportação agregada e anônima: sem apelidos, sem textos livres, sem horários, sem identificadores.
 * As linhas são ordenadas por identificador interno (aleatório), não por ordem de chegada.
 */
export function buildAggregateExport(
  teams: readonly TeamRecord[],
  mode: 'DEMONSTRAÇÃO' | 'CONECTADO',
  now: Date = new Date(),
): AggregateExport {
  return {
    geradoEm: now.toISOString(),
    modo: mode,
    avisoLimites: EXPORT_LIMITS_NOTICE,
    resumo: buildExportSummary(teams),
    linhas: buildExportRows(teams),
  };
}

export function rowsToCsv(rows: readonly ExportRow[]): string {
  if (rows.length === 0) return '';
  const header = Object.keys(rows[0]) as (keyof ExportRow)[];
  const lines = rows.map((r) => header.map((h) => String(r[h])).join(','));
  return [header.join(','), ...lines].join('\n') + '\n';
}
