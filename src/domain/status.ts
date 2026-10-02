import type { TeamRecord, TeamStatus } from './types';

export const STATUS_LABEL: Record<TeamStatus, string> = {
  entrou: 'Entrou',
  fez_diagnostico: 'Fez o diagnóstico',
  explorando: 'Explorando',
  pediu_dica: 'Pediu dica',
  tentou: 'Tentou',
  concluiu: 'Concluiu',
};

export const STATUS_ICON: Record<TeamStatus, string> = {
  entrou: '○',
  fez_diagnostico: '◔',
  explorando: '◑',
  pediu_dica: '?',
  tentou: '✎',
  concluiu: '✔',
};

/** Estado exibido ao professor, derivado dos registros (sem campo redundante a manter). */
export function deriveStatus(team: TeamRecord): TeamStatus {
  if (team.exit) return 'concluiu';

  const lastHint = Math.max(0, ...team.hints.map((h) => h.viewedAt));
  const lastAttempt = Math.max(0, ...team.attempts.map((a) => a.submittedAt));
  if (lastHint > 0 || lastAttempt > 0) return lastHint > lastAttempt ? 'pediu_dica' : 'tentou';

  if (team.exploringSince !== null) return 'explorando';
  if (team.diagnostic) return 'fez_diagnostico';
  return 'entrou';
}

export function maxHintLevel(team: Pick<TeamRecord, 'hints'>): 0 | 1 | 2 | 3 {
  return team.hints.reduce<0 | 1 | 2 | 3>((max, h) => (h.level > max ? h.level : max), 0);
}
