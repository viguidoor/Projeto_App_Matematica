import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { Projection } from '../src/components/Projection';
import { StudentApp } from '../src/components/student/StudentApp';
import { TeacherPanel } from '../src/components/teacher/TeacherPanel';
import { RepositoryProvider } from '../src/data/context';
import { RepositoryError } from '../src/data/repository';
import { makeRepo } from './helpers';

type Repo = ReturnType<typeof makeRepo>['repo'];

const wrap = (repo: Repo, ui: React.ReactElement) => <RepositoryProvider repository={repo}>{ui}</RepositoryProvider>;

async function enter(user: ReturnType<typeof userEvent.setup>, code: string, alias = 'Equipe Ipê') {
  await user.click(screen.getByRole('button', { name: 'Começar' }));
  await user.type(screen.getByLabelText('Código da sessão'), code);
  await user.type(screen.getByLabelText('Apelido da equipe'), alias);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  await screen.findByRole('heading', { name: 'Questão diagnóstica' });
}

async function fillForm(user: ReturnType<typeof userEvent.setup>, o: { calc: string; answer: string; unit: 'm' | 'm²'; why: string }) {
  await user.type(screen.getByLabelText('Cálculo da equipe'), o.calc);
  await user.type(screen.getByLabelText('Área encontrada (número)'), o.answer);
  await user.click(screen.getByRole('radio', { name: o.unit === 'm' ? /^m \(metro\)/ : /m² \(metro quadrado\)/ }));
  await user.type(screen.getByLabelText(/Justificativa/), o.why);
}

const submit = (user: ReturnType<typeof userEvent.setup>, name: RegExp) => user.click(screen.getByRole('button', { name }));

describe('acessibilidade básica', () => {
  it('abertura e entrada não têm violações do axe', async () => {
    const { repo } = makeRepo();
    const user = userEvent.setup();
    const { container } = render(wrap(repo, <StudentApp />));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('campos têm rótulos, erros são anunciados e o foco vai ao primeiro campo inválido', async () => {
    const { repo } = makeRepo();
    const { code } = await repo.openSession();
    const user = userEvent.setup();
    const { container } = render(wrap(repo, <StudentApp />));
    await enter(user, code);

    await submit(user, /Enviar diagnóstico/);
    const calc = screen.getByLabelText('Cálculo da equipe');
    expect(calc).toHaveAttribute('aria-invalid', 'true');
    expect(calc).toHaveFocus();
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/Registrem o cálculo/);
    expect(screen.getByRole('group', { name: /Unidade da resposta/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a figura tem nome e descrição acessíveis com D, d e unidades', async () => {
    const { repo } = makeRepo();
    const { code } = await repo.openSession();
    const user = userEvent.setup();
    render(wrap(repo, <StudentApp />));
    await enter(user, code);
    const fig = screen.getByRole('img', { name: /painel do refeitório/i });
    expect(fig).toHaveAccessibleDescription(/Diagonal maior D: 8 metros.*Diagonal menor d: 5 metros/);
  });
});

describe('diagonais iguais (quadrado)', () => {
  async function toExplore() {
    const { repo } = makeRepo();
    const { code } = await repo.openSession();
    const user = userEvent.setup();
    const view = render(wrap(repo, <StudentApp />));
    await enter(user, code);
    await fillForm(user, { calc: '8 x 5 : 2', answer: '20', unit: 'm²', why: 'Metade do produto.' });
    await submit(user, /Enviar diagnóstico/);
    await screen.findByRole('heading', { name: /Hipótese inicial: explorem o jardim/ });
    return { user, repo, view };
  }

  it('permite D = d, explica que o losango vira quadrado e não revela a área', async () => {
    const { user, view } = await toExplore();
    expect(screen.queryByText(/Diagonais iguais/)).not.toBeInTheDocument();
    expect(screen.getByText(/nunca fica menor que a menor/)).toBeInTheDocument();

    const minor = screen.getByLabelText('Diagonal menor (d)');
    await user.clear(minor);
    await user.type(minor, '10'); // d = D = 10
    const note = await screen.findByRole('complementary', { name: /Diagonais iguais/ });
    expect(note).toHaveTextContent(/caso particular de losango/);
    expect(note).toHaveTextContent(/retângulo.*também é um quadrado/);
    expect(screen.getByRole('img', { name: /Jardim/ })).toHaveAccessibleDescription(/o losango é um quadrado/);
    expect(view.container.textContent).not.toMatch(/50\s*m²/);
    expect(await axe(view.container)).toHaveNoViolations();

    // D não pode ficar abaixo de d
    expect(screen.getByRole('button', { name: /Diminuir diagonal maior/ })).toBeDisabled();
    const major = screen.getByLabelText('Diagonal maior (D)');
    await user.clear(major);
    await user.type(major, '9');
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/entre 10 m e 20 m/);
  });

  it('o aviso some quando as diagonais voltam a ser diferentes', async () => {
    const { user } = await toExplore();
    const minor = screen.getByLabelText('Diagonal menor (d)');
    await user.clear(minor);
    await user.type(minor, '10');
    await screen.findByRole('complementary', { name: /Diagonais iguais/ });
    await user.click(screen.getByRole('button', { name: /Diminuir diagonal menor/ }));
    expect(screen.queryByRole('complementary', { name: /Diagonais iguais/ })).not.toBeInTheDocument();
  });

  it('a hipótese com D = d também mostra o aviso e aceita a área correta (D × d ÷ 2)', async () => {
    const { user, repo } = await toExplore();
    const minor = screen.getByLabelText('Diagonal menor (d)');
    await user.clear(minor);
    await user.type(minor, '10');
    await user.click(screen.getByRole('button', { name: /Registrar hipótese inicial com D = 10 m e d = 10 m/ }));
    await screen.findByRole('heading', { name: 'Hipótese inicial da equipe' });
    expect(screen.getByRole('complementary', { name: /Diagonais iguais/ })).toBeInTheDocument();
    await fillForm(user, { calc: '10 x 10 : 2', answer: '50', unit: 'm²', why: 'O quadrado tem diagonais iguais.' });
    await submit(user, /Enviar hipótese inicial/);
    await screen.findByRole('heading', { name: 'Devolutiva da hipótese inicial' });
    expect(screen.getByText(/a área do jardim é 50 m²/)).toBeInTheDocument();
    const [team] = await repo.listTeams((await repo.getCurrentSession())!.code);
    expect(team.hypothesis).toMatchObject({ major: 10, minor: 10, answer: 50, correct: true });
  });
});

describe('jornada do estudante (modo DEMONSTRAÇÃO)', () => {
  it('mostra o aviso de DEMONSTRAÇÃO', async () => {
    const { repo } = makeRepo();
    render(wrap(repo, <StudentApp />));
    expect(screen.getByRole('status')).toHaveTextContent(/DEMONSTRAÇÃO/);
  });

  it('rejeita código inválido com mensagem clara e não pede nome completo', async () => {
    const { repo } = makeRepo();
    await repo.openSession();
    const user = userEvent.setup();
    render(wrap(repo, <StudentApp />));
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    await user.type(screen.getByLabelText('Código da sessão'), 'AAAAAA');
    await user.type(screen.getByLabelText('Apelido da equipe'), 'Equipe Ipê');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText(/Código não encontrado/)).toBeInTheDocument();
    expect(screen.getByText(/Não usem nome completo/)).toBeInTheDocument();
  });

  it('percorre as 4 etapas: diagnóstico → hipótese inicial → tentativas/revisões → saída, sem revelar a área antes', async () => {
    const { repo } = makeRepo();
    const { code } = await repo.openSession();
    const user = userEvent.setup();
    const { container } = render(wrap(repo, <StudentApp />));
    await enter(user, code);

    // Diagnóstico: sem dicas, sem correção
    expect(screen.queryByRole('button', { name: /dica/i })).not.toBeInTheDocument();
    await fillForm(user, { calc: '8 x 5', answer: '40', unit: 'm²', why: 'Multipliquei as diagonais.' });
    await submit(user, /Enviar diagnóstico/);
    await screen.findByRole('heading', { name: /Hipótese inicial: explorem o jardim/ });
    expect(screen.queryByText(/não confere|Confere/i)).not.toBeInTheDocument();

    // Exploração: nenhuma área calculada aparece; controles equivalentes
    expect(screen.queryByText(/30\s*m²/)).not.toBeInTheDocument();
    const fig = () => screen.getByRole('img', { name: /Jardim em forma de losango/ });
    expect(fig()).toHaveAccessibleDescription(/maior D: 10 metros.*menor d: 6 metros/);

    await user.click(screen.getByRole('button', { name: /Aumentar diagonal maior/ }));
    expect(fig()).toHaveAccessibleDescription(/maior D: 10,5 metros/);

    const major = screen.getByLabelText('Diagonal maior (D)');
    await user.clear(major);
    await user.type(major, '10');
    expect(fig()).toHaveAccessibleDescription(/maior D: 10 metros/);

    fireEvent.change(screen.getByLabelText('Diagonal menor (d) (controle deslizante)'), { target: { value: '6' } });

    // Valor inválido: mensagem, sem alterar a figura
    await user.clear(major);
    await user.type(major, 'abc');
    expect(major).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/Use apenas algarismos/);
    expect(fig()).toHaveAccessibleDescription(/maior D: 10 metros/);
    // diagonal maior não pode ficar menor que a menor
    await user.clear(major);
    await user.type(major, '5');
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/entre 6 m e 20 m/);
    await user.clear(major);
    await user.type(major, '10');

    expect(await axe(container)).toHaveNoViolations();

    expect(screen.getByText(/Missão 1 — Jardim Geométrico · Etapa 2\/4 · Hipótese inicial/)).toBeInTheDocument();
    // Dicas bloqueadas até o envio da hipótese inicial (na exploração e no formulário da hipótese)
    expect(screen.queryByRole('button', { name: /Pedir a dica/ })).not.toBeInTheDocument();
    expect(screen.getByText(/As dicas ficam disponíveis depois que a equipe registrar a hipótese inicial/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Registrar hipótese inicial com D = 10 m e d = 6 m/ }));
    await screen.findByRole('heading', { name: 'Hipótese inicial da equipe' });
    expect(screen.queryByRole('button', { name: /Pedir a dica/ })).not.toBeInTheDocument();
    expect(screen.getByText(/As dicas ficam disponíveis depois que a equipe registrar a hipótese inicial/)).toBeInTheDocument();
    expect(screen.queryByText(/30\s*m²/)).not.toBeInTheDocument();

    // Hipótese inicial: 60 m² (sem ÷2)
    await fillForm(user, { calc: '10 x 6', answer: '60', unit: 'm²', why: 'Área é base vezes altura.' });
    await submit(user, /Enviar hipótese inicial/);
    await screen.findByRole('heading', { name: 'Devolutiva da hipótese inicial' });
    expect(screen.getByText(/Etapa 2\/4 · Hipótese inicial/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations(); // acessibilidade também na devolutiva da hipótese inicial
    expect(screen.getByText(/Vocês multiplicaram as duas diagonais/)).toBeInTheDocument();
    expect(screen.queryByText(/30\s*m²/)).not.toBeInTheDocument(); // não entrega a resposta

    // Dicas 1 e 2: cada uma só aparece depois de pedida
    expect(screen.queryByText(/Dica 1: identifiquem/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Pedir a dica 1 de 3/ }));
    expect(screen.getByText(/Dica 1: identifiquem as diagonais/)).toBeInTheDocument();
    expect(screen.queryByText(/Dica 2: pensem/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Pedir a dica 2 de 3/ }));
    expect(screen.getByText(/Dica 2: pensem em um retângulo/)).toBeInTheDocument();
    expect(screen.queryByText(/Dica 3: comparem/)).not.toBeInTheDocument();

    // Etapa 3: tentativa/revisão → 30 m²
    await user.click(screen.getByRole('button', { name: 'Nova tentativa' }));
    await screen.findByRole('heading', { name: /Revisão: explorem o jardim de novo/ });
    expect(screen.getByText(/Missão 1 — Jardim Geométrico · Etapa 3\/4 · Tentativas e revisões/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Registrar nova tentativa/ }));
    await screen.findByRole('heading', { name: 'Tentativa 1 da equipe' });
    await fillForm(user, { calc: '10 x 6 : 2', answer: '30', unit: 'm²', why: 'O losango é metade do retângulo que o envolve.' });
    await submit(user, /Enviar tentativa/);
    await screen.findByRole('heading', { name: 'Devolutiva da tentativa 1' });
    expect(screen.getByText(/a área do jardim é 30 m²/)).toBeInTheDocument();

    // Etapa 4: saída sem dicas e sem resultado antes do envio
    await user.click(screen.getByRole('button', { name: 'Ir ao problema final' }));
    await screen.findByRole('heading', { name: 'Problema final' });
    expect(screen.getByText(/Missão 1 — Jardim Geométrico · Etapa 4\/4 · Problema final/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pedir a dica/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/24\s*m²/)).not.toBeInTheDocument();
    await fillForm(user, { calc: '12 x 4 : 2', answer: '24', unit: 'm²', why: 'Metade de 12 vezes 4.' });
    await submit(user, /Enviar resolução final/);
    await screen.findByRole('heading', { name: 'Missão concluída' });
    expect(screen.getByText(/A área do canteiro é 24 m²/)).toBeInTheDocument();

    // O repositório guardou tudo separado: diagnóstico → hipótese inicial → revisões → saída
    const [team] = await repo.listTeams(code);
    expect(team.diagnostic?.answer).toBe(40);
    expect(team.hypothesis).toMatchObject({ answer: 60, hintLevel: 0 });
    expect(team.attempts.map((a) => [a.answer, a.hintLevel])).toEqual([[30, 2]]);
    expect(team.exit?.answer).toBe(24);
  });

  it('volta de onde parou depois de atualizar a página', async () => {
    const { repo } = makeRepo();
    const { code } = await repo.openSession();
    const user = userEvent.setup();
    const first = render(wrap(repo, <StudentApp />));
    await enter(user, code);
    await fillForm(user, { calc: '8 x 5 : 2', answer: '20', unit: 'm²', why: 'Metade do produto.' });
    await submit(user, /Enviar diagnóstico/);
    await screen.findByRole('heading', { name: /Hipótese inicial: explorem o jardim/ });
    first.unmount();

    render(wrap(repo, <StudentApp />));
    expect(await screen.findByRole('heading', { name: /Hipótese inicial: explorem o jardim/ })).toBeInTheDocument();
    expect(screen.getByText(/Etapa 2\/4 · Hipótese inicial/)).toBeInTheDocument();
    expect(screen.getByText(/Equipe Ipê/)).toBeInTheDocument();
  });

  it('o professor encerra a sessão e o envio é recusado com mensagem clara', async () => {
    const { repo } = makeRepo();
    const { code } = await repo.openSession();
    const user = userEvent.setup();
    render(wrap(repo, <StudentApp />));
    await enter(user, code);
    await repo.closeSession(code);
    await fillForm(user, { calc: '8 x 5 : 2', answer: '20', unit: 'm²', why: 'Metade do produto.' });
    await submit(user, /Enviar diagnóstico/);
    expect((await screen.findAllByText(/sessão foi encerrada/)).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/Não é mais possível enviar respostas/)).toBeInTheDocument(); // aviso na tela, mesmo sem novo envio
  });
});

describe('limite de entradas do serviço de login (mesma rede/IP)', () => {
  it('mostra uma mensagem clara, mantém o formulário preenchido e permite tentar de novo', async () => {
    const { repo } = makeRepo();
    const { code } = await repo.openSession();
    let blocked = true;
    const limited = Object.assign(Object.create(repo), {
      joinSession: async (c: string, a: string) => {
        if (blocked) throw new RepositoryError('RATE_LIMITED', 'Muitas equipes entraram ao mesmo tempo pela mesma rede. Aguardem alguns minutos e tentem de novo, ou chamem o professor.');
        return repo.joinSession(c, a);
      },
    }) as Repo;
    const user = userEvent.setup();
    const { container } = render(wrap(limited, <StudentApp />));
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    await user.type(screen.getByLabelText('Código da sessão'), code);
    await user.type(screen.getByLabelText('Apelido da equipe'), 'Equipe Ipê');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText(/pela mesma rede/)).toBeInTheDocument();
    expect(screen.getByLabelText('Código da sessão')).toHaveValue(code);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
    expect(await axe(container)).toHaveNoViolations();
    blocked = false;
    await user.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByRole('heading', { name: 'Questão diagnóstica' });
  });
});

describe('orientação ao professor quando a conexão cai', () => {
  it('mostra o estado em texto e como verificar se o Supabase está ativo; o estudante vê a mensagem combinada', async () => {
    const { repo } = makeRepo();
    let state: 'connected' | 'reconnecting' | 'offline' = 'offline';
    const listeners = new Set<() => void>();
    const connected = Object.assign(Object.create(repo), {
      connection: { get: () => state, subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)) },
    }) as Repo;
    const user = userEvent.setup();
    const teacherView = render(wrap(connected, <TeacherPanel />));
    await user.click(screen.getByRole('button', { name: 'Entrar na demonstração' }));
    expect(await screen.findByText(/projeto do Supabase está ativo/)).toBeInTheDocument();
    expect(screen.getByText(/pausado depois de 1 semana sem uso/)).toBeInTheDocument();
    state = 'connected';
    listeners.forEach((l) => l());
    await waitFor(() => expect(screen.queryByText(/projeto do Supabase está ativo/)).not.toBeInTheDocument());
    teacherView.unmount();

    state = 'offline';
    render(wrap(connected, <StudentApp />));
    expect(await screen.findByText(/Não foi possível conectar ao servidor\. Verifique a conexão e avise o professor\./)).toBeInTheDocument();
    expect(screen.queryByText(/projeto do Supabase/)).not.toBeInTheDocument(); // o estudante não vê orientação técnica
  });
});

describe('login docente (repositório conectado)', () => {
  it('exige login, mostra erro compreensível, é acessível e abre o painel depois de entrar', async () => {
    const { repo } = makeRepo();
    let signedIn = false;
    const calls: string[] = [];
    const connected = Object.assign(Object.create(repo), {
      teacherAuth: {
        isSignedIn: async () => signedIn,
        signIn: async (email: string, password: string) => {
          calls.push(email);
          if (password !== 'certa') throw new Error('E-mail ou senha incorretos.');
          signedIn = true;
        },
        signOut: async () => {
          signedIn = false;
        },
      },
    }) as Repo;
    const user = userEvent.setup();
    const { container } = render(wrap(connected, <TeacherPanel />));
    expect(await screen.findByRole('form', { name: 'Login do professor' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir sessão' })).not.toBeInTheDocument(); // sem login, nada do painel
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Entrar como professor' }));
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/Digite o e-mail e a senha/);
    await user.type(screen.getByLabelText('E-mail da conta docente'), 'prof@escola.test');
    await user.type(screen.getByLabelText('Senha'), 'errada');
    await user.click(screen.getByRole('button', { name: 'Entrar como professor' }));
    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Senha'));
    await user.type(screen.getByLabelText('Senha'), 'certa');
    await user.click(screen.getByRole('button', { name: 'Entrar como professor' }));
    expect(await screen.findByRole('button', { name: 'Abrir sessão' })).toBeInTheDocument();
    expect(calls).toEqual(['prof@escola.test', 'prof@escola.test']);
  });
});

describe('painel do professor e projeção (DEMONSTRAÇÃO)', () => {
  it('avisa que não há login nem sincronização real e passa no axe', async () => {
    const { repo } = makeRepo();
    const user = userEvent.setup();
    const { container } = render(wrap(repo, <TeacherPanel />));
    expect(screen.getByText(/não há login/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar na demonstração' }));
    expect(screen.getByRole('status')).toHaveTextContent(/DEMONSTRAÇÃO.*NÃO sincronizam/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('abre sessão, mostra código, equipes fictícias marcadas e padrões como hipóteses', async () => {
    const { repo } = makeRepo();
    const user = userEvent.setup();
    const { container } = render(wrap(repo, <TeacherPanel />));
    await user.click(screen.getByRole('button', { name: 'Entrar na demonstração' }));
    await user.click(screen.getByRole('button', { name: 'Abrir sessão' }));
    const session = (await repo.getCurrentSession())!;
    expect(await screen.findByText(session.code)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Carregar equipes FICTÍCIAS/ }));
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('fictícia').length).toBeGreaterThanOrEqual(5);
    expect(within(table).getAllByText(/Concluiu/).length).toBe(2);
    expect(within(table).getByText(/Pediu dica/)).toBeInTheDocument();
    expect(screen.getByText(/hipóteses pedagógicas/i, { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getAllByText(/possível omissão da divisão por 2/).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('atualiza quando um estudante age em outra "aba" (mesmo repositório) sem recarregar', async () => {
    const { repo } = makeRepo();
    const session = await repo.openSession();
    const user = userEvent.setup();
    render(wrap(repo, <TeacherPanel />));
    await user.click(screen.getByRole('button', { name: 'Entrar na demonstração' }));
    expect(await screen.findByText(/Nenhuma equipe ainda/)).toBeInTheDocument();
    await act(async () => {
      await repo.joinSession(session.code, 'Equipe Nova');
    });
    expect(await screen.findByRole('rowheader', { name: 'Equipe Nova' })).toBeInTheDocument();
  });

  it('registra nota de mediação e projeta exemplo anônimo sem apelido', async () => {
    const { repo } = makeRepo();
    const user = userEvent.setup();
    const { code } = await repo.openSession();
    await repo.seedFictitiousTeams!(code);
    render(wrap(repo, <TeacherPanel />));
    await user.click(screen.getByRole('button', { name: 'Entrar na demonstração' }));

    await user.type(await screen.findByLabelText('Dificuldade observada'), 'Esqueceram a divisão por 2');
    await user.type(screen.getByLabelText('Pergunta ou intervenção'), 'Como o losango se relaciona ao retângulo?');
    await user.type(screen.getByLabelText('Resposta após a mediação'), 'Refizeram com ÷2');
    await user.click(screen.getByRole('button', { name: 'Salvar nota' }));
    expect(await screen.findByText(/Refizeram com ÷2/)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /Ver.*detalhes de Fictícia Delta/ })[0]);
    expect((await repo.getProjection()).kind).toBe('none'); // nada é projetado sem revisão
    await user.click(screen.getAllByRole('button', { name: /Revisar e projetar como exemplo/ })[0]);
    const confirm = await screen.findByRole('button', { name: 'Projetar este exemplo' });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Revisei o texto/ }));
    await user.click(confirm);
    await waitFor(async () => expect((await repo.getProjection()).kind).toBe('example'));
    const proj = await repo.getProjection();
    expect(JSON.stringify(proj)).not.toMatch(/Fictícia|Delta/);
  });

  it('mostra a data de exclusão dos dados brutos (30 dias) e lembra de baixar a exportação anônima', async () => {
    const { repo } = makeRepo();
    const user = userEvent.setup();
    render(wrap(repo, <TeacherPanel />));
    await user.click(screen.getByRole('button', { name: 'Entrar na demonstração' }));
    await user.click(screen.getByRole('button', { name: 'Abrir sessão' }));
    const note = await screen.findByText(/serão apagados automaticamente em/);
    expect(note).toHaveTextContent(/30 dias/);
    expect(note).toHaveTextContent(/exportação anônima/);
    const session = (await repo.getCurrentSession())!;
    expect(session.retentionUntil! - session.openedAt).toBe(30 * 86_400_000);
    expect(note.textContent).toContain(new Date(session.retentionUntil!).toLocaleDateString('pt-BR'));
  });

  it('a pré-visualização oculta dados pessoais da justificativa antes de projetar', async () => {
    const { repo } = makeRepo();
    const user = userEvent.setup();
    const { code } = await repo.openSession();
    const team = await repo.joinSession(code, 'Equipe Ipê');
    await repo.submitDiagnostic(team.id, {
      calculation: '8 x 5',
      rawAnswer: '40',
      unit: 'm²',
      justification: 'Eu, Maria Souza, multipliquei e a equipe Ipê chamou no zap.',
    });
    const { container } = render(wrap(repo, <TeacherPanel />));
    await user.click(screen.getByRole('button', { name: 'Entrar na demonstração' }));
    await user.click(await screen.findByRole('button', { name: /Ver.*detalhes de Equipe Ipê/ }));
    await user.click(screen.getByRole('button', { name: /Revisar e projetar como exemplo/ }));

    const box = (await screen.findByText(/é exatamente isto que a turma verá/)).closest('.preview-box') as HTMLElement;
    expect(box).toHaveTextContent('[oculto]');
    expect(box).not.toHaveTextContent(/Maria|Souza|Ipê/);
    expect(await axe(container)).toHaveNoViolations();

    // o professor pode ocultar uma palavra a mais e retirar a justificativa por completo
    await user.click(screen.getByRole('button', { name: /^multipliquei/ }));
    expect(box).not.toHaveTextContent(/multipliquei/);
    await user.click(screen.getByRole('checkbox', { name: /Não projetar a justificativa/ }));
    expect(box).not.toHaveTextContent(/Justificativa:/);
    await user.click(screen.getByRole('checkbox', { name: /Revisei o texto/ }));
    await user.click(screen.getByRole('button', { name: 'Projetar este exemplo' }));

    await waitFor(async () => expect((await repo.getProjection()).kind).toBe('example'));
    const proj = await repo.getProjection();
    expect(JSON.stringify(proj)).not.toMatch(/Maria|Souza|Ipê|multipliquei/);
    expect(proj.kind === 'example' && proj.example.justification).toBe('');
  });

  it('cancelar a revisão não projeta nada', async () => {
    const { repo } = makeRepo();
    const user = userEvent.setup();
    const { code } = await repo.openSession();
    await repo.seedFictitiousTeams!(code);
    render(wrap(repo, <TeacherPanel />));
    await user.click(screen.getByRole('button', { name: 'Entrar na demonstração' }));
    await user.click((await screen.findAllByRole('button', { name: /Ver.*detalhes de Fictícia Farol/ }))[0]);
    await user.click(screen.getAllByRole('button', { name: /Revisar e projetar como exemplo/ })[0]);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('button', { name: 'Projetar este exemplo' })).not.toBeInTheDocument();
    expect((await repo.getProjection()).kind).toBe('none');
  });

  it('a tela de projeção mostra só dados agregados ou exemplo anônimo', async () => {
    const { repo } = makeRepo();
    const { code } = await repo.openSession();
    await repo.seedFictitiousTeams!(code);
    await repo.setProjection({ kind: 'distribution', stage: 'diagnostico', showCorrect: false });
    const { container } = render(wrap(repo, <Projection />));
    expect(await screen.findByText(/respostas da turma/)).toBeInTheDocument();
    await waitFor(() => expect(container.textContent).toMatch(/de \d+ equipes/));
    expect(container.textContent).not.toMatch(/Fictícia|Aurora|Brisa|Delta|Farol/);
    expect(container.textContent).not.toMatch(/✔ confere/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
