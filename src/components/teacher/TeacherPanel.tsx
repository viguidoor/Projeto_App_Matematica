import { useEffect, useId, useState, type FormEvent } from 'react';
import { ConnectionStatus } from '../ConnectionStatus';
import { ModeBanner } from '../ModeBanner';
import { ScreenHeading } from '../ScreenHeading';
import { useRepository } from '../../data/context';
import { useSnapshot } from '../../data/snapshot';
import { countPatterns } from '../../domain/aggregate';
import { PATTERNS } from '../../domain/evaluate';
import { STATUS_ICON, STATUS_LABEL, deriveStatus, maxHintLevel } from '../../domain/status';
import type { Session, Submission, TeamStatus } from '../../domain/types';
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

function answerCell(s: Submission | null): string {
  return s ? `${formatNumber(s.answer)} ${s.unit} ${s.correct ? '✔' : '✎'}` : '—';
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const repo = useRepository();
  const uid = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('Digite o e-mail e a senha da conta docente.');
    setBusy(true);
    try {
      await repo.teacherAuth!.signIn(email.trim(), password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      setBusy(false);
    }
  };
  return (
    <form className="answer-form login-form" onSubmit={submit} noValidate aria-label="Login do professor">
      <div className="field">
        <label htmlFor={`${uid}-e`}>E-mail da conta docente</label>
        <input id={`${uid}-e`} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-p`}>Senha</label>
        <input id={`${uid}-p`} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <p className="field-error" role="alert">{error}</p>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar como professor'}</button>
    </form>
  );
}

export function TeacherPanel() {
  const repo = useRepository();
  const [entered, setEntered] = useState(false);
  const [checking, setChecking] = useState(!!repo.teacherAuth);
  const needsLogin = !!repo.teacherAuth;

  useEffect(() => {
    if (!repo.teacherAuth) return;
    repo.teacherAuth.isSignedIn().then((ok) => setEntered(ok)).catch(() => {}).finally(() => setChecking(false));
  }, [repo]);

  if (checking) return <p role="status">Carregando…</p>;
  if (needsLogin && !entered) {
    return (
      <div className="app app-wide">
        <ModeBanner role="professor" />
        <main id="conteudo">
          <ScreenHeading>Painel do professor</ScreenHeading>
          <p className="lead">Entre com a conta docente. O acesso é verificado no servidor.</p>
          <LoginForm onDone={() => setEntered(true)} />
        </main>
      </div>
    );
  }
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
      <ConnectionStatus audience="teacher" />
      <main id="conteudo">
        <ScreenHeading>Painel do professor</ScreenHeading>

        <section className="card" aria-labelledby="sess">
          <h3 id="sess">Sessão</h3>
          <p>{sessionLabel(session)}</p>
          {session?.retentionUntil && (
            <p className="help">
              Os dados brutos desta sessão serão apagados automaticamente em {new Date(session.retentionUntil).toLocaleDateString('pt-BR')} (30 dias).
              A <strong>exportação anônima</strong> (mais abaixo) é o registro que fica com você: baixe-a antes dessa data.
            </p>
          )}
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
            {session && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (window.confirm('Apagar esta sessão e todos os dados dela (equipes, respostas, notas)? Não dá para desfazer. Você já baixou a exportação anônima?')) {
                    setPreview(null);
                    run(() => repo.deleteSession(session.code));
                  }
                }}
              >
                Apagar esta sessão e seus dados
              </button>
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
                  <tr><th scope="col">Equipe</th><th scope="col">Estado</th><th scope="col">Diagnóstico</th><th scope="col">Hipótese inicial</th><th scope="col">Revisões</th><th scope="col">Dicas</th><th scope="col">Saída</th><th scope="col">Detalhes</th></tr>
                </thead>
                <tbody>
                  {teams.map((t) => {
                    const st = deriveStatus(t);
                    const expanded = openId === t.id;
                    return (
                      <FragmentRows key={t.id} expanded={expanded} detail={<TeamDetail team={t} onPreview={setPreview} />}>
                        <th scope="row">{t.alias}{t.fictitious && <span className="tag">fictícia</span>}</th>
                        <td><span aria-hidden="true">{STATUS_ICON[st]}</span> {STATUS_LABEL[st]}</td>
                        <td>{answerCell(t.diagnostic)}</td>
                        <td>{answerCell(t.hypothesis)}</td>
                        <td>{t.attempts.length}{t.attempts.length > 0 && ` (última: ${answerCell(t.attempts[t.attempts.length - 1])})`}</td>
                        <td>{maxHintLevel(t)} de 3</td>
                        <td>{answerCell(t.exit)}</td>
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

        <ProjectionControls projection={projection} sessionCode={session?.code} />
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
        <tr className="detail-row"><td colSpan={9}>{detail}</td></tr>
      )}
    </>
  );
}
