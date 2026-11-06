import { expect, type Page } from '@playwright/test';

// O menu principal (components/site-chrome.tsx; ADR 0034): abaixo de 1024 px é uma folha `popover`, fechada (display: none) até o botão
// "Menu" a abrir; a partir de 1024 px a cápsula já está na tela. `getByRole` não acha link escondido: todo spec que usa um link do
// cabeçalho (fora a marca) abre o menu antes.
export async function abrirMenu(page: Page) {
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  if (await button.isVisible()) await button.click();
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
}
