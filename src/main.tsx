import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { RepositoryProvider } from './data/context';
import { DemoRepository } from './data/demoRepository';
import { LocalStorageStore } from './data/kvStore';

// Etapa 1: somente repositório de DEMONSTRAÇÃO (sem Firebase, sem credenciais).
const repository = new DemoRepository(new LocalStorageStore());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepositoryProvider repository={repository}>
      <App />
    </RepositoryProvider>
  </StrictMode>,
);
