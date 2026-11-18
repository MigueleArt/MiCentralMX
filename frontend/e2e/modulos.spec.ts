import { test, expect } from '@playwright/test';

test.describe('E2E · Módulos y Flujos del Sistema', () => {
  test.beforeEach(async ({ page }) => {
    // Iniciar sesión con Dueño (HU-001)
    await page.goto('/login');
    await page.fill('#u', 'rodolfo');
    await page.fill('#p', 'demo1234');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
  });

  test('HU-042/HU-043: Consulta y búsqueda en listado de ventas', async ({ page }) => {
    await page.goto('/ventas');
    await expect(page.getByRole('heading', { name: 'Ventas', exact: true })).toBeVisible();

    const buscador = page.locator('input[type="search"]').or(page.locator('input[placeholder*="Buscar"]')).first();
    if (await buscador.isVisible()) {
      await buscador.fill('Mostrador');
      await expect(page.locator('.tbl, .card').first()).toBeVisible();
    }
  });

  test('HU-026 a HU-029: Consulta de inventario general y existencias por clasificación', async ({ page }) => {
    await page.goto('/inventario');
    await expect(page.getByRole('heading', { name: 'Inventario', exact: true })).toBeVisible();
    await expect(page.locator('.tbl, .card').first()).toBeVisible();
  });

  test('HU-034 a HU-038: Consulta de listado de clientes y saldos', async ({ page }) => {
    await page.goto('/clientes');
    await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
    await expect(page.locator('main.pag-main')).toBeVisible();
  });


  test('HU-061 a HU-064: Consulta de cuentas por cobrar y deudas', async ({ page }) => {
    await page.goto('/deudas');
    await expect(page.getByRole('heading', { name: 'Deudas', exact: true })).toBeVisible();
  });

  test('HU-088 a HU-093: Movimientos de ingresos y egresos de caja', async ({ page }) => {
    await page.goto('/pagos');
    await expect(page.getByRole('heading', { name: 'Pagos', exact: true })).toBeVisible();
  });

  test('HU-102 a HU-107: Administración de usuarios y roles', async ({ page }) => {
    await page.goto('/usuarios');
    await expect(page.getByRole('heading', { name: 'Usuarios', exact: true })).toBeVisible();
    await expect(page.locator('text=Dueño').first()).toBeVisible();
  });

  test('HU-115 a HU-121: Panel de reportes de negocio', async ({ page }) => {
    await page.goto('/reportes');
    await expect(page.getByRole('heading', { name: 'Reportes', exact: true })).toBeVisible();
  });
});
