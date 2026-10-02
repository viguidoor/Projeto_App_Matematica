import { useRepository } from '../data/context';

export function ModeBanner({ role }: { role: 'estudante' | 'professor' | 'projecao' }) {
  const repo = useRepository();
  if (repo.mode === 'connected') {
    return (
      <div className="mode-banner mode-connected" role="status">
        <strong>CONECTADO</strong> — dados sincronizados com o servidor.
      </div>
    );
  }
  return (
    <div className="mode-banner mode-demo" role="status">
      <strong>DEMONSTRAÇÃO</strong> —{' '}
      {role === 'professor'
        ? 'sem autenticação e sem servidor. Os dados ficam só neste navegador; abas deste mesmo navegador se atualizam, mas outros navegadores ou dispositivos NÃO sincronizam (isso é a Etapa 2).'
        : role === 'projecao'
          ? 'tela de projeção de demonstração; lê os dados deste navegador.'
          : 'os dados ficam só neste navegador e não chegam a outros dispositivos.'}
    </div>
  );
}
