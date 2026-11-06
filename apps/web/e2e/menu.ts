import { expect, type Page } from '@playwright/test';

// A navegação principal (ADR 0035). Na casca do site (components/site-chrome.tsx), abaixo de 1024 px ela é uma folha `popover`, fechada
// (display: none) até o botão "Menu" a abrir; a partir de 1024 px os links já estão na tela. Na casca do app (components/app-shell.tsx) ela
// está sempre na tela (o trilho no desktop, a barra de abas no pé no celular), e não há nada a abrir. `getByRole` não acha link escondido:
// todo spec que usa um link do cabeçalho (fora a marca) chama esta função antes, nas duas cascas.
export async function abrirMenu(page: Page) {
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  if (await button.isVisible()) await button.click();
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
}
