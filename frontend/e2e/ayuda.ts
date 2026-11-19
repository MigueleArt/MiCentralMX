import { expect, type Page } from '@playwright/test';

export async function completarOnboarding(page: Page) {
  const bienvenida = page.getByRole('heading', { name: 'Bienvenido a MiCentralMX' });
  if (!(await bienvenida.isVisible())) return;

  await page.getByRole('button', { name: 'Comenzar' }).click();
  await page.getByRole('button', { name: /Registrar ventas/ }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Frutas' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Acepto los términos de uso de MiCentralMX.').check();
  await page.getByLabel('He leído y acepto el aviso de privacidad.').check();
  await page.getByRole('button', { name: 'Entrar a MiCentralMX' }).click();
}

export async function iniciarSesionDemo(page: Page) {
  await page.goto('/login');
  await page.fill('#u', 'rodolfo');
  await page.fill('#p', 'demo1234');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/');
  await completarOnboarding(page);
  await expect(page.getByText('Jitomate Saladette', { exact: false }).first()).toBeVisible({ timeout: 15000 });
}
