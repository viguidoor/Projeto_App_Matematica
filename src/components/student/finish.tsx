import { AnswerForm } from '../AnswerForm';
import { RhombusFigure } from '../RhombusFigure';
import { ScreenHeading } from '../ScreenHeading';
import { useRepository } from '../../data/context';
import { formatNumber, rhombusArea } from '../../domain/area';
import { EXIT_PROBLEM } from '../../domain/mission';
import type { TeamRecord } from '../../domain/types';

export function Exit({ team, onTeam }: { team: TeamRecord; onTeam: (t: TeamRecord) => void }) {
  const repo = useRepository();
  const p = EXIT_PROBLEM;
  return (
    <section>
      <ScreenHeading>{p.title}</ScreenHeading>
      <p className="lead">{p.context}</p>
      <div className="two-col">
        <RhombusFigure {...p.measures} label="Canteiro da horta em forma de losango" />
        <div>
          <p className="question">{p.question}</p>
          <p className="help">Este problema não tem dicas. O resultado aparece depois do envio.</p>
          <AnswerForm
            legend="Resolução final da equipe"
            submitLabel="Enviar resolução final"
            onSubmit={async (input) => {
              await repo.submitExit(team.id, input);
              const fresh = await repo.getTeam(team.id);
              if (fresh) onTeam(fresh);
            }}
          />
        </div>
      </div>
    </section>
  );
}

export function Done({ team }: { team: TeamRecord }) {
  const exit = team.exit;
  if (!exit) return null;
  const area = rhombusArea(exit.major, exit.minor);
  return (
    <section>
      <ScreenHeading>Missão concluída</ScreenHeading>
      <p className="your-answer">Resposta da equipe: <strong>{formatNumber(exit.answer)} {exit.unit}</strong></p>
      {exit.correct ? (
        <div className="feedback feedback-ok" role="status">
          <strong>✔ Confere.</strong> A área do canteiro é {formatNumber(area)} m².
        </div>
      ) : (
        <div className="feedback feedback-retry" role="status">
          <strong>✎ Não confere.</strong> A área do canteiro, com D = {formatNumber(exit.major)} m e d = {formatNumber(exit.minor)} m, é {formatNumber(area)} m². O professor vai retomar esse ponto com a turma.
        </div>
      )}
      <p>Registrem no caderno a síntese: como se calcula a área de um losango e por quê. Depois, aguardem as orientações do professor.</p>
    </section>
  );
}
