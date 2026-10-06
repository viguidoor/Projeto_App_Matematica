import { useEffect, useState } from 'react';
import { ConnectionStatus } from '../ConnectionStatus';
import { ModeBanner } from '../ModeBanner';
import { useRepository } from '../../data/context';
import { missionStageText, stageOf } from '../../domain/stages';
import { Done, Exit } from './finish';
import { Intro, Join } from './entry';
import { Diagnostic, Explore, Feedback, Hypothesis } from './mission';
import type { TeamRecord } from '../../domain/types';

const IDENTITY_KEY = 'operacao-area/student-team';

function readIdentity(): string | null {
  try {
    return window.sessionStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
}
function writeIdentity(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(IDENTITY_KEY, id);
    else window.sessionStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* sem armazenamento: a equipe precisará entrar de novo após atualizar */
  }
}

export function StudentApp() {
  const repo = useRepository();
  const [team, setTeam] = useState<TeamRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<'intro' | 'join'>('intro');

  // Recuperação após atualizar a página: a equipe volta de onde parou.
  useEffect(() => {
    const id = readIdentity();
    if (!id) {
      setLoading(false);
      return;
    }
    repo
      .getTeam(id)
      .then((t) => {
        if (t) setTeam(t);
        else writeIdentity(null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [repo]);

  // Percebe, por exemplo, que o professor encerrou a sessão.
  const teamId = team?.id;
  useEffect(() => {
    if (!teamId) return;
    return repo.subscribe(
      () => {
        repo.getTeam(teamId).then((t) => t && setTeam(t)).catch(() => {});
      },
      { intervalMs: 15000 },
    );
  }, [repo, teamId]);

  const adopt = (t: TeamRecord) => {
    writeIdentity(t.id);
    setTeam(t);
  };

  let body;
  if (loading) body = <p role="status">Carregando…</p>;
  else if (!team) body = screen === 'intro' ? <Intro onStart={() => setScreen('join')} /> : <Join onJoined={adopt} />;
  else {
    const props = { team, onTeam: adopt };
    switch (team.phase) {
      case 'diagnostico': body = <Diagnostic {...props} />; break;
      case 'exploracao': body = <Explore {...props} />; break;
      case 'hipotese': body = <Hypothesis {...props} />; break;
      case 'feedback': body = <Feedback {...props} />; break;
      case 'saida': body = <Exit {...props} />; break;
      default: body = <Done team={team} />;
    }
  }

  return (
    <div className="app">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <header className="app-header">
        <p className="brand">Operação Área</p>
        {team && (
          <p className="team-chip">
            Equipe: <strong>{team.alias}</strong>
          </p>
        )}
        {team && <p className="mission-stage">{missionStageText(stageOf(team))}</p>}
      </header>
      <ModeBanner role="estudante" />
      <ConnectionStatus />
      {team?.sessionClosed && (
        <div className="feedback feedback-retry" role="alert">
          <strong>A sessão foi encerrada pelo professor.</strong> Não é mais possível enviar respostas. Aguardem as orientações.
        </div>
      )}
      <main id="conteudo">{body}</main>
    </div>
  );
}
