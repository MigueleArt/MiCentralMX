import { expect, test } from '@playwright/test';
import { iniciarSesionDemo } from './ayuda';

test.describe('Mejoras de clientes y compras', () => {
  test.beforeEach(async ({ page }) => {
    await iniciarSesionDemo(page);
  });

  test('valida y explica el formulario para agregar clientes', async ({ page }) => {
    await page.goto('/clientes/nuevo');
    await expect(page.getByRole('heading', { name: 'Identificación y contacto' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Condiciones de crédito' })).toBeVisible();

    await page.getByRole('button', { name: 'Guardar cliente' }).click();
    await expect(page.getByText('Escribe el nombre o negocio del cliente.')).toBeVisible();

    await page.locator('#cn').fill('Cafetería Central');
    await page.locator('#ct').fill('123');
    await page.getByRole('button', { name: '30 días' }).click();
    await page.getByRole('button', { name: 'Guardar cliente' }).click();
    await expect(page.getByText('El teléfono debe tener al menos 10 dígitos.')).toBeVisible();
    await expect(page.getByText(/vencimiento de 30 días/)).toBeVisible();
  });

  test('muestra los datos actuales y detecta cambios al editar un cliente', async ({ page }) => {
    await page.goto('/clientes');
    await page.getByRole('searchbox', { name: 'Buscar cliente' }).fill('Abarrotes Doña Lupe');
    await page.getByRole('link', { name: /Abarrotes Doña Lupe/ }).click();
    await page.getByRole('link', { name: 'Editar cliente' }).click();

    await expect(page.locator('#cn')).toHaveValue('Abarrotes Doña Lupe');
    await expect(page.getByRole('button', { name: 'Sin cambios' })).toBeDisabled();
    await page.locator('#cu').fill('Nave B, puesto 20');
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  test('filtra compras y permite consultar el detalle completo de solo lectura', async ({ page }) => {
    await page.goto('/compras');
    await expect(page.getByText('Últimos 7 días', { exact: true })).toBeVisible();
    await expect(page.getByText('Registrado a crédito', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Todo el historial' }).click();
    await page.getByRole('searchbox', { name: 'Buscar compra' }).fill('Agrícola San Juan');

    const detalle = page.getByRole('button', { name: 'Ver detalles' }).first();
    await expect(detalle).toBeVisible();
    await detalle.click();
    const modal = page.getByRole('dialog');
    await expect(modal).toContainText('Proveedor · quién vendió');
    await expect(modal).toContainText('Agrícola San Juan');
    await expect(modal).toContainText('Mercancía comprada');
    await expect(modal).toContainText('Consulta de solo lectura');
    await expect(modal.locator('input, select, textarea')).toHaveCount(0);
  });

  test('presenta avance y subtotales en una nueva compra', async ({ page }) => {
    await page.goto('/compras/nueva');
    await expect(page.getByLabel('Avance de la compra')).toBeVisible();
    await expect(page.getByText('Falta proveedor')).toBeVisible();
    await page.locator('#pp-0').click();
    await page.locator('.sheet button.rowlink:has-text("Jitomate Saladette")').click();
    await expect(page.getByText('Subtotal de la partida')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar compra' })).toBeDisabled();
  });
});
