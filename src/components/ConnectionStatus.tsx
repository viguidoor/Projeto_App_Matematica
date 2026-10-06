import { useEffect, useState } from 'react';
import { useRepository } from '../data/context';
import type { ConnectionState } from '../data/repository';

const LABEL: Record<ConnectionState, string> = {
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  offline: 'Sem conexão: os envios ficam na fila e são repetidos',
};

/** Estado da conexão em TEXTO (não depende de cor). Só aparece com repositório conectado. */
export function ConnectionStatus() {
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
    <p className={`connection connection-${state}`} role="status" aria-live="polite">
      Conexão: {LABEL[state]}
    </p>
  );
}
