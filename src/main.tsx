import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { RepositoryProvider } from './data/context';
import { DemoRepository } from './data/demoRepository';
import { LocalStorageStore } from './data/kvStore';
import type { SessionRepository } from './data/repository';
import { SupabaseRepository } from './data/supabase/supabaseRepository';

/**
 * VITE_BACKEND=demo (padrão): modo DEMONSTRAÇÃO, sem servidor e sem credenciais.
 * VITE_BACKEND=supabase: modo CONECTADO (precisa de VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY, a chave PÚBLICA).
 */
function createRepository(): SessionRepository | string {
  if (import.meta.env.VITE_BACKEND === 'supabase') {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return 'Configuração incompleta: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (chave pública) ou use VITE_BACKEND=demo.';
    return new SupabaseRepository({ url, anonKey });
  }
  return new DemoRepository(new LocalStorageStore());
}

const repository = createRepository();
const root = createRoot(document.getElementById('root')!);

if (typeof repository === 'string') {
  root.render(<p role="alert" style={{ padding: '1rem', fontFamily: 'system-ui' }}>{repository}</p>);
} else {
  root.render(
    <StrictMode>
      <RepositoryProvider repository={repository}>
        <App />
      </RepositoryProvider>
    </StrictMode>,
  );
}
