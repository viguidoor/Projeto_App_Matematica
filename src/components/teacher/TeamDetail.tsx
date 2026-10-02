import { useRepository } from '../../data/context';
import { formatNumber } from '../../domain/area';
import { PATTERNS } from '../../domain/evaluate';
import type { ProjectionStage, Submission, TeamRecord } from '../../domain/types';

function SubmissionView({ title, s, stage }: { title: string; s: Submission; stage: ProjectionStage }) {
  const repo = useRepository();
  const pattern = s.patternId ? PATTERNS[s.patternId] : null;
  const project = () =>
    repo.setProjection({
      kind: 'example',
      showCorrect: false,
      example: {
        stage,
        major: s.major,
        minor: s.minor,
        calculation: s.calculation,
        answerText: `${formatNumber(s.answer)} ${s.unit}`,
        justification: s.justification,
        correct: s.correct,
      },
    });
  return (
    <li className="submission">
      <p><strong>{title}</strong> · D = {formatNumber(s.major)} m, d = {formatNumber(s.minor)} m · resposta <strong>{formatNumber(s.answer)} {s.unit}</strong> {s.correct ? '✔' : '✎'}</p>
      <p>Cálculo: {s.calculation}</p>
      <p>Justificativa: {s.justification}</p>
      {pattern && (
        <p className="hypothesis">
          <strong>Hipótese pedagógica:</strong> {pattern.teacherHypothesis}
          <br /><em>Pergunta possível: {pattern.teacherQuestion}</em>
        </p>
      )}
      <button type="button" className="btn btn-small" onClick={project}>
        Projetar como exemplo anônimo<span className="sr-only"> ({title})</span>
      </button>
    </li>
  );
}

export function TeamDetail({ team }: { team: TeamRecord }) {
  return (
    <div className="team-detail">
      <h4>Registros de {team.alias} (diagnóstico, tentativas e saída ficam separados)</h4>
      <ul className="plain">
        {team.diagnostic ? <SubmissionView title="Diagnóstico (sem dicas)" s={team.diagnostic} stage="diagnostico" /> : <li>Diagnóstico: ainda não enviado.</li>}
        {team.attempts.map((a) => (
          <SubmissionView key={a.n} title={`Tentativa ${a.n} (${a.hintLevel === 0 ? 'sem dicas' : `após dica ${a.hintLevel}`})`} s={a} stage="tentativa" />
        ))}
        {team.attempts.length === 0 && <li>Tentativas: nenhuma.</li>}
        {team.exit ? <SubmissionView title="Saída (sem dicas)" s={team.exit} stage="saida" /> : <li>Saída: ainda não enviada.</li>}
      </ul>
      <p>Dicas abertas: {team.hints.length === 0 ? 'nenhuma' : team.hints.map((h) => h.level).join(', ')}.</p>
    </div>
  );
}
