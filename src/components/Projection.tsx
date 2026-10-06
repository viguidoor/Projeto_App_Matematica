import { ModeBanner } from './ModeBanner';
import { useLiveData } from '../data/context';
import { MIN_TEAMS_FOR_DISTRIBUTION } from '../domain/aggregate';
import { formatNumber } from '../domain/area';
import type { ProjectionStage, ProjectionView } from '../domain/types';

const STAGE_TITLE: Record<ProjectionStage, string> = {
  diagnostico: 'Diagnóstico: respostas da turma',
  hipotese: 'Hipótese inicial: respostas da turma',
  tentativa: 'Primeira revisão: respostas da turma',
  saida: 'Problema final: respostas da turma',
};

/** Tela para TV/projetor. Só recebe dados agregados ou um exemplo anônimo escolhido pelo professor. */
export function Projection({ code }: { code?: string }) {
  const projection = useLiveData<ProjectionView>((repo) => repo.getProjectionView(code), { kind: 'none' });
  let body;

  if (projection.kind === 'none') {
    body = <p className="proj-wait">Aguardando o professor escolher o que mostrar.</p>;
  } else if (projection.kind === 'distribution') {
    const d = projection.distribution;
    body = (
      <>
        <h2>{STAGE_TITLE[projection.stage]}</h2>
        {d.suppressed ? (
          <p className="proj-wait">Aguardando mais respostas (a distribuição aparece com {MIN_TEAMS_FOR_DISTRIBUTION} ou mais equipes). Respostas até agora: {d.total}.</p>
        ) : (
          <>
            <ul className="bars">
              {d.entries.map((e) => (
                <li key={e.label}>
                  <span className="bar-label">{e.label}{projection.showCorrect && e.correct ? ' ✔ confere' : ''}</span>
                  <span className="bar" aria-hidden="true" style={{ width: `${(e.count / d.total) * 100}%` }} />
                  <span className="bar-count">{e.count} de {d.total} equipes</span>
                </li>
              ))}
              {d.others > 0 && (
                <li>
                  <span className="bar-label">Outras respostas</span>
                  <span className="bar bar-other" aria-hidden="true" style={{ width: `${(d.others / d.total) * 100}%` }} />
                  <span className="bar-count">{d.others} de {d.total} equipes</span>
                </li>
              )}
            </ul>
          </>
        )}
      </>
    );
  } else {
    const ex = projection.example;
    body = (
      <>
        <h2>Exemplo para discutir (anônimo)</h2>
        <div className="example">
          <p>Losango com D = {formatNumber(ex.major)} m e d = {formatNumber(ex.minor)} m</p>
          <p>Cálculo: <strong>{ex.calculation}</strong></p>
          <p>Resposta: <strong>{ex.answerText}</strong>{projection.showCorrect ? (ex.correct ? ' ✔ confere' : ' ✎ não confere') : ''}</p>
          {ex.justification && <p>Justificativa: “{ex.justification}”</p>}
        </div>
      </>
    );
  }

  return (
    <div className="app app-projection">
      <ModeBanner role="projecao" />
      <main id="conteudo">
        <h1>Operação Área</h1>
        {body}
      </main>
    </div>
  );
}
