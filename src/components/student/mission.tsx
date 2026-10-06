import { useEffect, useState } from 'react';
import { AnswerForm } from '../AnswerForm';
import { DiagonalControl } from '../DiagonalControl';
import { HintPanel } from '../HintPanel';
import { RhombusFigure } from '../RhombusFigure';
import { ScreenHeading } from '../ScreenHeading';
import { useRepository } from '../../data/context';
import { RepositoryError } from '../../data/repository';
import { formatNumber, MAX_DIAGONAL, MIN_DIAGONAL } from '../../domain/area';
import { GENERIC_FEEDBACK, PATTERNS } from '../../domain/evaluate';
import { DIAGNOSTIC_PROBLEM, DIAGONAL_RULE_HELP, GARDEN_CONTEXT, REVISION_CONTEXT, SQUARE_NOTE } from '../../domain/mission';
import { maxHintLevel } from '../../domain/status';
import type { Diagonals, HintLevel, SubmissionInput, TeamRecord } from '../../domain/types';

interface ScreenProps {
  team: TeamRecord;
  onTeam: (team: TeamRecord) => void;
}

function SquareNote({ major, minor }: Diagonals) {
  if (major !== minor) return null;
  return (
    <aside className="square-note" aria-label={SQUARE_NOTE.title}>
      <strong>{SQUARE_NOTE.title}.</strong> {SQUARE_NOTE.text}
    </aside>
  );
}

function useActions(team: TeamRecord, onTeam: (t: TeamRecord) => void) {
  const repo = useRepository();
  const refresh = async () => {
    const fresh = await repo.getTeam(team.id);
    if (fresh) onTeam(fresh);
  };
  return { repo, refresh };
}

export function Diagnostic({ team, onTeam }: ScreenProps) {
  const { repo, refresh } = useActions(team, onTeam);
  const p = DIAGNOSTIC_PROBLEM;
  return (
    <section>
      <ScreenHeading>{p.title}</ScreenHeading>
      <p className="lead">{p.context}</p>
      <div className="two-col">
        <RhombusFigure {...p.measures} label="Painel do refeitório em forma de losango" />
        <div>
          <p className="question">{p.question}</p>
          <p className="help">Esta questão ainda não tem dicas. Respondam do jeito que a equipe entende; o resultado aparece para o professor.</p>
          <AnswerForm
            legend="Resposta da equipe"
            submitLabel="Enviar diagnóstico"
            onSubmit={async (input: SubmissionInput) => {
              await repo.submitDiagnostic(team.id, input);
              await refresh();
            }}
          />
        </div>
      </div>
    </section>
  );
}

export function Explore({ team, onTeam }: ScreenProps) {
  const { repo, refresh } = useActions(team, onTeam);
  const [diag, setDiag] = useState<Diagonals>(team.diagonals);
  const [error, setError] = useState('');
  const level = maxHintLevel(team);
  const isRevision = team.hypothesis !== null;

  // Guarda as medidas (com pequena espera) para sobreviverem a uma atualização de página.
  useEffect(() => {
    if (diag.major === team.diagonals.major && diag.minor === team.diagonals.minor) return;
    const timer = setTimeout(() => {
      repo.saveProgress(team.id, { diagonals: diag }).then(onTeam).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diag]);

  const goHypothesis = async () => {
    setError('');
    try {
      await repo.saveProgress(team.id, { diagonals: diag, phase: 'hipotese' });
      await refresh();
    } catch (e) {
      setError(e instanceof RepositoryError ? e.message : 'Não foi possível continuar.');
    }
  };

  return (
    <section>
      <ScreenHeading>{isRevision ? 'Revisão: explorem o jardim de novo' : 'Hipótese inicial: explorem o jardim'}</ScreenHeading>
      <p className="lead">{isRevision ? REVISION_CONTEXT : GARDEN_CONTEXT}</p>
      <div className="two-col">
        <RhombusFigure {...diag} showRectangle={level >= 2} showTriangles={level >= 3} onChange={setDiag} />
        <div>
          <div className="controls">
            <DiagonalControl label="Diagonal maior (D)" noun="diagonal maior" value={diag.major}
              min={Math.max(MIN_DIAGONAL, diag.minor)} max={MAX_DIAGONAL} onChange={(v) => setDiag((d) => ({ ...d, major: v }))} />
            <DiagonalControl label="Diagonal menor (d)" noun="diagonal menor" value={diag.minor}
              min={MIN_DIAGONAL} max={diag.major} onChange={(v) => setDiag((d) => ({ ...d, minor: v }))} />
          </div>
          <p className="help">{DIAGONAL_RULE_HELP}</p>
          <SquareNote {...diag} />
          <p className="help">A área ainda não aparece: primeiro a equipe propõe a sua resposta. Podem arrastar os pontos da figura, usar o controle deslizante, digitar ou usar os botões − e +.</p>
          <button type="button" className="btn btn-primary" onClick={goHypothesis}>
            {isRevision ? 'Registrar nova tentativa' : 'Registrar hipótese inicial'} com D = {formatNumber(diag.major)} m e d = {formatNumber(diag.minor)} m
          </button>
          <p className="field-error" role="alert">{error}</p>
        </div>
      </div>
      {isRevision ? <HintArea team={team} onTeam={onTeam} /> : <HintsLocked />}
    </section>
  );
}

/** Antes da hipótese inicial não há dicas: a primeira proposta da equipe é sempre feita sem apoio. */
function HintsLocked() {
  return (
    <section className="hints" aria-labelledby="hints-locked-title">
      <h3 id="hints-locked-title">Dicas</h3>
      <p className="help">As dicas ficam disponíveis depois que a equipe registrar a hipótese inicial. Primeiro explorem e proponham a resposta do jeito que a equipe entende.</p>
    </section>
  );
}

function HintArea({ team, onTeam }: ScreenProps) {
  const { repo } = useActions(team, onTeam);
  return (
    <HintPanel
      team={team}
      onHint={async (level: HintLevel) => {
        onTeam(await repo.recordHint(team.id, level));
      }}
    />
  );
}

export function Hypothesis({ team, onTeam }: ScreenProps) {
  const { repo, refresh } = useActions(team, onTeam);
  const level = maxHintLevel(team);
  const { major, minor } = team.diagonals;
  const isRevision = team.hypothesis !== null;
  const n = team.attempts.length + 1;
  const [backError, setBackError] = useState('');
  return (
    <section>
      <ScreenHeading>{isRevision ? `Tentativa ${n} da equipe` : 'Hipótese inicial da equipe'}</ScreenHeading>
      <p className="lead">
        Jardim com diagonal maior D = {formatNumber(major)} m e diagonal menor d = {formatNumber(minor)} m. Qual será a área?
      </p>
      <div className="two-col">
        <RhombusFigure major={major} minor={minor} showRectangle={level >= 2} showTriangles={level >= 3} />
        <div>
          <SquareNote major={major} minor={minor} />
          <AnswerForm
            legend={isRevision ? `Tentativa ${n}` : 'Hipótese inicial'}
            submitLabel={isRevision ? 'Enviar tentativa' : 'Enviar hipótese inicial'}
            onSubmit={async (input) => {
              if (isRevision) await repo.submitAttempt(team.id, input);
              else await repo.submitHypothesis(team.id, input);
              await refresh();
            }}
          />
          <button
            type="button"
            className="btn btn-link"
            onClick={async () => {
              setBackError('');
              try {
                await repo.saveProgress(team.id, { phase: 'exploracao' });
                await refresh();
              } catch (e) {
                setBackError(e instanceof RepositoryError ? e.message : 'Não foi possível voltar. Tentem de novo.');
              }
            }}
          >
            Voltar e ajustar as medidas
          </button>
          <p className="field-error" role="alert">{backError}</p>
        </div>
      </div>
      {isRevision ? <HintArea team={team} onTeam={onTeam} /> : <HintsLocked />}
    </section>
  );
}

export function Feedback({ team, onTeam }: ScreenProps) {
  const { repo, refresh } = useActions(team, onTeam);
  const [confirming, setConfirming] = useState(false);
  const last = team.attempts[team.attempts.length - 1] ?? team.hypothesis;
  if (!last) return null;
  const title = team.attempts.length === 0 ? 'Devolutiva da hipótese inicial' : `Devolutiva da tentativa ${team.attempts.length}`;
  const level = maxHintLevel(team);

  const [error, setError] = useState('');
  const go = async (phase: 'exploracao' | 'saida') => {
    setError('');
    try {
      await repo.saveProgress(team.id, { phase });
      await refresh();
    } catch (e) {
      setError(e instanceof RepositoryError ? e.message : 'Não foi possível continuar. Tentem de novo.');
    }
  };

  return (
    <section>
      <ScreenHeading>{title}</ScreenHeading>
      <div className="two-col">
        <RhombusFigure major={last.major} minor={last.minor} showRectangle={level >= 2} showTriangles={level >= 3} />
        <div>
          <p className="your-answer">Resposta da equipe: <strong>{formatNumber(last.answer)} {last.unit}</strong></p>
          {last.correct ? (
            <div className="feedback feedback-ok" role="status">
              <strong>✔ Confere.</strong> Com D = {formatNumber(last.major)} m e d = {formatNumber(last.minor)} m, a área do jardim é {formatNumber(last.answer)} m².
              Registrem no caderno por que esse cálculo funciona.
            </div>
          ) : (
            <div className="feedback feedback-retry" role="status">
              <strong>✎ Ainda não confere.</strong>{' '}
              {last.patternId ? PATTERNS[last.patternId].studentFeedback : GENERIC_FEEDBACK}
              <p>Se quiserem, chamem o professor para conversar antes da nova tentativa.</p>
            </div>
          )}

          <div className="actions">
            {!last.correct && (
              <button type="button" className="btn btn-primary" onClick={() => go('exploracao')}>Nova tentativa</button>
            )}
            {last.correct && (
              <button type="button" className="btn btn-primary" onClick={() => go('saida')}>Ir ao problema final</button>
            )}
            {!last.correct && !confirming && (
              <button type="button" className="btn btn-link" onClick={() => setConfirming(true)}>Ir ao problema final</button>
            )}
          </div>
          <p className="field-error" role="alert">{error}</p>
          {confirming && !last.correct && (
            <div className="confirm" role="alertdialog" aria-label="Confirmar ida ao problema final">
              <p>No problema final não há dicas e não é possível voltar. Querem continuar?</p>
              <button type="button" className="btn" onClick={() => go('saida')}>Sim, ir ao problema final</button>{' '}
              <button type="button" className="btn btn-link" onClick={() => setConfirming(false)}>Ainda não</button>
            </div>
          )}
        </div>
      </div>
      {!last.correct && <HintArea team={team} onTeam={onTeam} />}
    </section>
  );
}
