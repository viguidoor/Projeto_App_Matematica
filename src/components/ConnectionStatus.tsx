import { useEffect, useState } from 'react';
import { useRepository } from '../data/context';
import type { ConnectionState } from '../data/repository';

export const SERVER_UNREACHABLE = 'Não foi possível conectar ao servidor. Verifique a conexão e avise o professor.';

const LABEL: Record<ConnectionState, string> = {
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  offline: SERVER_UNREACHABLE,
};

const TEACHER_HINT =
  'Se a conexão não voltar: verifique se o projeto do Supabase está ativo (o plano gratuito é pausado depois de 1 semana sem uso; restaure-o no painel do Supabase) e se a rede da escola libera o serviço. Enquanto isso o painel tenta de novo sozinho; o modo DEMONSTRAÇÃO continua disponível como plano B.';

/** Estado da conexão em TEXTO (não depende de cor). Só aparece com repositório conectado. */
export function ConnectionStatus({ audience = 'student' }: { audience?: 'student' | 'teacher' }) {
  const repo = useRepository();
  const monitor = repo.connection;
  const [state, setState] = useState<ConnectionState>(() => monitor?.get() ?? 'connected');
  useEffect(() => {
    if (!monitor) return;
    setState(monitor.get());
    return monitor.subscribe(() => setState(monitor.get()));
  }, [monitor]);
  if (!monitor) return null;
  return (
    <div className={`connection connection-${state}`} role="status" aria-live="polite">
      <p>Conexão: {LABEL[state]}</p>
      {audience === 'teacher' && state !== 'connected' && <p className="help">{TEACHER_HINT}</p>}
    </div>
  );
}
