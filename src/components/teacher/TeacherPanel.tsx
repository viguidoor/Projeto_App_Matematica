import { useState } from 'react';
import { ModeBanner } from '../ModeBanner';
import { ScreenHeading } from '../ScreenHeading';
import { useRepository } from '../../data/context';
import { useSnapshot } from '../../data/snapshot';
import { countPatterns } from '../../domain/aggregate';
import { PATTERNS } from '../../domain/evaluate';
import { STATUS_ICON, STATUS_LABEL, deriveStatus, maxHintLevel } from '../../domain/status';
import type { Session, TeamStatus, TeamRecord } from '../../domain/types';
import { ExamplePreview, type PreviewRequest } from './ExamplePreview';
import { ExportButtons } from './ExportButtons';
import { Notes } from './Notes';
import { ProjectionControls } from './ProjectionControls';
import { TeamDetail } from './TeamDetail';
import { formatNumber } from '../../domain/area';

const STATUS_ORDER: TeamStatus[] = ['entrou', 'fez_diagnostico', 'explorando', 'pediu_dica', 'tentou', 'concluiu'];

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function sessionLabel(s: Session | null, now = Date.now()): string {
  if (!s) return 'Nenhuma sessão aberta';
  if (s.closedAt !== null) return `Sessão encerrada às ${timeOf(s.closedAt)}`;
  if (now >= s.expiresAt) return 'Código expirado (a sessão segue aberta para quem já entrou)';
  return `Sessão aberta · código válido até ${timeOf(s.expiresAt)}`;
}

function lastAnswer(t: TeamRecord): string {
  const a = t.attempts[t.attempts.length - 1];
  return a ? `${formatNumber(a.answer)} ${a.unit} ${a.correct ? '✔' : '✎'}` : '—';
}

export function TeacherPanel() {
  const [entered, setEntered] = useState(false);
  if (!entered) {
    return (
      <div className="app app-wide">
        <ModeBanner role="professor" />
        <main id="conteudo">
          <ScreenHeading>Painel do professor</ScreenHeading>
          <p className="lead">
            Nesta etapa <strong>não há login</strong>: qualquer pessoa com este endereço neste navegador entra. A proteção real (conta docente
            verificada no servidor e código de sessão validado no servidor) é a Etapa 2.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setEntered(true)}>Entrar na demonstração</button>
        </main>
      </div>
    );
  }
  return <Dashboard />;
}

function Dashboard() {
  const repo = useRepository();
  const { session, teams, notes, projection } = useSnapshot();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewRequest | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ação não concluída.');
    }
  };
  const isOpen = !!session && session.closedAt === null;
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<TeamStatus, number>;
  teams.forEach((t) => (counts[deriveStatus(t)] += 1));
  const patterns = countPatterns(teams);

  return (
    <div className="app app-wide">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <ModeBanner role="professor" />
      <main id="conteudo">
        <ScreenHeading>Painel do professor</ScreenHeading>

        <section className="card" aria-labelledby="sess">
          <h3 id="sess">Sessão</h3>
          <p>{sessionLabel(session)}</p>
          {session && isOpen && (
            <p>Código para os estudantes: <strong className="session-code" aria-label={`Código ${session.code.split('').join(' ')}`}>{session.code}</strong></p>
          )}
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => run(() => repo.openSession())}>
              {isOpen ? 'Abrir nova sessão (novo código)' : 'Abrir sessão'}
            </button>
            {session && isOpen && (
              <button type="button" className="btn" onClick={() => run(() => repo.closeSession(session.code))}>Encerrar sessão</button>
            )}
            <a className="btn" href="#/" target="_blank" rel="noopener noreferrer">Abrir tela do estudante (nova aba)</a>
          </div>
          {session && repo.seedFictitiousTeams && (
            <div className="actions">
              <button type="button" className="btn" onClick={() => run(() => repo.seedFictitiousTeams!(session.code))}>Carregar equipes FICTÍCIAS (ensaio)</button>
              <button type="button" className="btn" onClick={() => run(() => repo.removeFictitiousTeams!(session.code))}>Remover equipes fictícias</button>
              <button type="button" className="btn" onClick={() => { if (window.confirm('Apagar todos os dados da demonstração neste navegador?')) run(() => repo.resetAll!()); }}>Limpar tudo</button>
            </div>
          )}
          <p className="field-error" role="alert">{error}</p>
        </section>

        <section className="card" aria-labelledby="resumo">
          <h3 id="resumo">Estados das equipes ({teams.length})</h3>
          <ul className="status-summary">
            {STATUS_ORDER.map((s) => (
              <li key={s}><span aria-hidden="true">{STATUS_ICON[s]}</span> {STATUS_LABEL[s]}: <strong>{counts[s]}</strong></li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="equipes">
          <h3 id="equipes">Equipes</h3>
          {teams.length === 0 ? (
            <p>Nenhuma equipe ainda. {isOpen ? 'Compartilhe o código.' : 'Abra uma sessão.'}</p>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Equipes, estados e respostas</caption>
                <thead>
                  <tr><th scope="col">Equipe</th><th scope="col">Estado</th><th scope="col">Diagnóstico</th><th scope="col">Tentativas</th><th scope="col">Dicas</th><th scope="col">Última tentativa</th><th scope="col">Saída</th><th scope="col">Detalhes</th></tr>
                </thead>
                <tbody>
                  {teams.map((t) => {
                    const st = deriveStatus(t);
                    const expanded = openId === t.id;
                    return (
                      <FragmentRows key={t.id} expanded={expanded} detail={<TeamDetail team={t} onPreview={setPreview} />}>
                        <th scope="row">{t.alias}{t.fictitious && <span className="tag">fictícia</span>}</th>
                        <td><span aria-hidden="true">{STATUS_ICON[st]}</span> {STATUS_LABEL[st]}</td>
                        <td>{t.diagnostic ? `${formatNumber(t.diagnostic.answer)} ${t.diagnostic.unit} ${t.diagnostic.correct ? '✔' : '✎'}` : '—'}</td>
                        <td>{t.attempts.length}</td>
                        <td>{maxHintLevel(t)} de 3</td>
                        <td>{lastAnswer(t)}</td>
                        <td>{t.exit ? `${formatNumber(t.exit.answer)} ${t.exit.unit} ${t.exit.correct ? '✔' : '✎'}` : '—'}</td>
                        <td>
                          <button type="button" className="btn btn-small" aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : t.id)}>
                            {expanded ? 'Ocultar' : 'Ver'}<span className="sr-only"> detalhes de {t.alias}</span>
                          </button>
                        </td>
                      </FragmentRows>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="help">✔ confere · ✎ ainda não confere. Este painel mostra apelidos e textos das equipes: não o projete.</p>
        </section>

        {preview && (
          <ExamplePreview
            request={preview}
            aliases={teams.map((t) => t.alias)}
            onCancel={() => setPreview(null)}
            onConfirm={async (example) => {
              await run(() => repo.setProjection({ kind: 'example', example, showCorrect: false }));
              setPreview(null);
            }}
          />
        )}

        <section className="card" aria-labelledby="padroes">
          <h3 id="padroes">Padrões de erro: hipóteses pedagógicas</h3>
          <p className="help">São indícios a verificar conversando com a equipe, não diagnósticos automáticos.</p>
          {patterns.length === 0 ? (
            <p>Nenhum padrão identificado até agora.</p>
          ) : (
            <ul>
              {patterns.map((p) => (
                <li key={p.patternId}>
                  <strong>{p.count}×</strong> {PATTERNS[p.patternId].teacherHypothesis}
                  <br /><em>Pergunta possível: {PATTERNS[p.patternId].teacherQuestion}</em>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ProjectionControls projection={projection} />
        <Notes session={session} teams={teams} notes={notes} />
        <ExportButtons teams={teams} />
      </main>
    </div>
  );
}

function FragmentRows({ children, expanded, detail }: { children: React.ReactNode; expanded: boolean; detail: React.ReactNode }) {
  return (
    <>
      <tr>{children}</tr>
      {expanded && (
        <tr className="detail-row"><td colSpan={8}>{detail}</td></tr>
      )}
    </>
  );
}
