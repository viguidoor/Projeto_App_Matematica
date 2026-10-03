import { formatNumber } from '../../domain/area';
import { PATTERNS } from '../../domain/evaluate';
import type { ProjectionStage, Submission, TeamRecord } from '../../domain/types';
import type { PreviewRequest } from './ExamplePreview';

function SubmissionView({ title, s, stage, onPreview }: { title: string; s: Submission; stage: ProjectionStage; onPreview: (r: PreviewRequest) => void }) {
  const pattern = s.patternId ? PATTERNS[s.patternId] : null;
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
      <button type="button" className="btn btn-small" onClick={() => onPreview({ title, stage, submission: s })}>
        Revisar e projetar como exemplo<span className="sr-only"> ({title})</span>
      </button>
    </li>
  );
}

export function TeamDetail({ team, onPreview }: { team: TeamRecord; onPreview: (r: PreviewRequest) => void }) {
  return (
    <div className="team-detail">
      <h4>Registros de {team.alias} (diagnóstico, tentativas e saída ficam separados)</h4>
      <ul className="plain">
        {team.diagnostic ? <SubmissionView title="Diagnóstico (sem dicas)" s={team.diagnostic} stage="diagnostico" onPreview={onPreview} /> : <li>Diagnóstico: ainda não enviado.</li>}
        {team.attempts.map((a) => (
          <SubmissionView key={a.n} title={`Tentativa ${a.n} (${a.hintLevel === 0 ? 'sem dicas' : `após dica ${a.hintLevel}`})`} s={a} stage="tentativa" onPreview={onPreview} />
        ))}
        {team.attempts.length === 0 && <li>Tentativas: nenhuma.</li>}
        {team.exit ? <SubmissionView title="Saída (sem dicas)" s={team.exit} stage="saida" onPreview={onPreview} /> : <li>Saída: ainda não enviada.</li>}
      </ul>
      <p>Dicas abertas: {team.hints.length === 0 ? 'nenhuma' : team.hints.map((h) => h.level).join(', ')}.</p>
    </div>
  );
}
