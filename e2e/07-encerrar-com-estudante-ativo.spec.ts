import { expect, test } from '@playwright/test';
import { closeActors, dbCount, expectNoUnexpectedErrors, fillAnswer, newActor, openSession, resetData, studentJoin, submitDiagnostic, teacherLogin, teamRow } from './helpers';

test('encerrar a sessão enquanto um estudante está ativo: ele é avisado, não perde o que digitou, não consegue enviar e o professor segue vendo tudo', async ({ browser }) => {
  await resetData();
  const prof = await newActor(browser, 'professor');
  const a = await newActor(browser, 'equipe A');
  const novo = await newActor(browser, 'estudante atrasado');
  await teacherLogin(prof.page);
  const code = await openSession(prof.page);
  await studentJoin(a.page, code, 'Equipe A');
  await submitDiagnostic(a.page, { calc: '8 x 5 : 2', answer: '20', why: 'Metade do produto.' });
  await a.page.getByRole('button', { name: /Registrar hipótese inicial/ }).click();
  await fillAnswer(a.page, { calc: '10 x 6 : 2', answer: '30', why: 'Metade do retângulo.' }); // digitou, ainda não enviou

  await test.step('o professor encerra a sessão', async () => {
    await prof.page.getByRole('button', { name: 'Encerrar sessão' }).click();
    await expect(prof.page.getByText(/Sessão encerrada às/)).toBeVisible();
    await expect(prof.page.getByRole('button', { name: 'Encerrar sessão' })).toHaveCount(0);
  });

  await test.step('o estudante ativo é avisado na própria tela, sem recarregar, e o que digitou continua lá', async () => {
    await expect(a.page.getByText('A sessão foi encerrada pelo professor.')).toBeVisible({ timeout: 40_000 });
    await expect(a.page.getByRole('alert').filter({ hasText: /Não é mais possível enviar respostas/ })).toBeVisible();
    await expect(a.page.getByLabel('Cálculo da equipe')).toHaveValue('10 x 6 : 2');
    await expect(a.page.getByLabel(/Justificativa/)).toHaveValue('Metade do retângulo.');
  });

  await test.step('tentar enviar depois do encerramento: recusado com mensagem clara; nada é gravado', async () => {
    await a.page.getByRole('button', { name: 'Enviar hipótese inicial' }).click();
    await expect(a.page.getByRole('alert').filter({ hasText: 'A sessão foi encerrada pelo professor.' }).last()).toBeVisible();
    await expect(a.page.getByRole('heading', { name: 'Hipótese inicial da equipe' })).toBeVisible(); // não saiu da tela
    expect(await dbCount(`select count(*)::int as n from public.submissions where kind = 'hipotese'`)).toBe(0);
    expect(await dbCount(`select count(*)::int as n from public.submissions where kind = 'diagnostico'`)).toBe(1); // o que já tinha sido enviado fica
  });

  await test.step('atualizar a página depois do encerramento mantém o aviso e o trabalho já enviado', async () => {
    await a.page.reload();
    await expect(a.page.getByText('A sessão foi encerrada pelo professor.')).toBeVisible();
    await expect(a.page.getByText('Equipe: Equipe A')).toBeVisible();
  });

  await test.step('um estudante que chega depois, com o mesmo código, não entra', async () => {
    await novo.page.goto('/#/');
    await novo.page.getByRole('button', { name: 'Começar' }).click();
    await novo.page.getByLabel('Código da sessão').fill(code);
    await novo.page.getByLabel('Apelido da equipe').fill('Equipe Atrasada');
    await novo.page.getByRole('button', { name: 'Entrar' }).click();
    await expect(novo.page.getByText('Essa sessão não está aberta. Peçam um novo código ao professor.')).toBeVisible();
    await expect(novo.page.getByRole('button', { name: 'Entrar' })).toBeEnabled(); // pode tentar com outro código
    expect(await dbCount(`select count(*)::int as n from public.teams`)).toBe(1);
  });

  await test.step('o professor continua vendo os dados da sessão encerrada e pode abrir uma nova', async () => {
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('20 m² ✔');
    await prof.page.getByRole('button', { name: /Abrir nova sessão|Abrir sessão/ }).click();
    await expect(prof.page.locator('.session-code')).not.toHaveText(code);
  });

  expectNoUnexpectedErrors([prof, novo], [/Failed to load resource: the server responded with a status of 4\d\d/]);
  expectNoUnexpectedErrors([a], [/Failed to load resource: the server responded with a status of 400/]); // a recusa provocada
  await closeActors(prof, a, novo);
});
