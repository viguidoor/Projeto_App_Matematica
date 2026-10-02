import { useEffect, useState } from 'react';
import { ModeBanner } from '../ModeBanner';
import { useRepository } from '../../data/context';
import { Done, Exit } from './finish';
import { Intro, Join } from './entry';
import { Diagnostic, Explore, Feedback, Hypothesis } from './mission';
import type { StudentPhase, TeamRecord } from '../../domain/types';

const IDENTITY_KEY = 'operacao-area/student-team';

const STEPS: Record<StudentPhase, { n: number; label: string }> = {
  diagnostico: { n: 1, label: 'Diagnóstico' },
  exploracao: { n: 2, label: 'Missão do Jardim' },
  hipotese: { n: 2, label: 'Missão do Jardim' },
  feedback: { n: 2, label: 'Missão do Jardim' },
  saida: { n: 3, label: 'Problema final' },
  concluido: { n: 3, label: 'Concluído' },
};

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
      .finally(() => setLoading(false));
  }, [repo]);

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

  const step = team ? STEPS[team.phase] : null;
  return (
    <div className="app">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <header className="app-header">
        <p className="brand">Operação Área</p>
        {team && (
          <p className="team-chip">
            Equipe: <strong>{team.alias}</strong>
            {step && <span className="step"> · Etapa {step.n} de 3: {step.label}</span>}
          </p>
        )}
      </header>
      <ModeBanner role="estudante" />
      <main id="conteudo">{body}</main>
    </div>
  );
}
