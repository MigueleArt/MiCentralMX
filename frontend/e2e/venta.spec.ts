import { test, expect } from '@playwright/test';
import { agregarClasificacionAlTicket, iniciarSesionDemo } from './ayuda';

test.describe('E2E · Flujo de Venta Completa (Contado y Crédito)', () => {
  test.beforeEach(async ({ page }) => {
    await iniciarSesionDemo(page);
  });

  test('registra una venta de contado desde el inventario disponible', async ({ page }) => {
    await page.goto('/ventas/nueva');
    await expect(page.getByRole('heading', { name: 'Inventario de hoy' })).toBeVisible();

    await agregarClasificacionAlTicket(page, /Aguacate Hass/, '5');
    await expect(page.getByText('Aguacate Hass', { exact: false }).last()).toBeVisible();
    await page.getByRole('button', { name: /Registrar venta/ }).click();

    await expect(page.getByRole('status')).toContainText('Venta registrada correctamente.');
  });

  test('registra una venta a crédito con cliente y plazo', async ({ page }) => {
    await page.goto('/ventas/nueva');
    await agregarClasificacionAlTicket(page, /Aguacate Hass/, '2');
    await page.getByLabel('Forma de pago').selectOption('credito');
    await page.getByLabel('Cliente').selectOption({ label: 'Abarrotes Doña Lupe' });
    await expect(page.getByLabel('Vence el')).toBeVisible();
    await page.getByRole('button', { name: /Registrar venta/ }).click();

    await expect(page.getByRole('status')).toContainText('Venta registrada correctamente.');
  });
});
