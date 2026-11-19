import { test, expect } from '@playwright/test';

test.describe('E2E · Mejoras v2.0 (Buscador rápido, Reportes y Abonos)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('#u', 'rodolfo');
    await page.fill('#p', 'demo1234');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
    await expect(page.locator('text=$16,394')).toBeVisible({ timeout: 15000 });
  });

  test('buscador rápido desde Inicio y en Nueva venta agiliza el registro', async ({ page }) => {
    // 1. Abrir buscador rápido desde Inicio
    const btnBuscarInicio = page.getByRole('button', { name: /Buscar producto, precio o existencia/i });
    await expect(btnBuscarInicio).toBeVisible();
    await btnBuscarInicio.click();

    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();

    // 2. Buscar multi-término sin acentos
    const inputGlobal = sheet.locator('input[type="search"]');
    await inputGlobal.fill('aguacate pri');
    await expect(sheet.locator('text=Aguacate Hass')).toBeVisible();
    await expect(sheet.locator('text=Primera / Grande')).toBeVisible();

    // 3. Saltar directo a Nueva venta con el producto preseleccionado
    await sheet.getByRole('button', { name: 'Vender' }).first().click();
    await expect(page).toHaveURL(/\/ventas\/nueva\?producto=/);
    await expect(page.locator('text=Clasificaciones, origen y precios')).toBeVisible();

    // 4. Agregar un segundo producto usando el buscador rápido inline de NuevaVenta
    const buscadorVenta = page.locator('#buscador-rapido-venta');
    await expect(buscadorVenta).toBeVisible();
    await buscadorVenta.fill('chile');
    await expect(page.locator('.venta-buscador-resultados').locator('text=Chile serrano')).toBeVisible();
    await buscadorVenta.press('Enter');

    const cantidadChile = page.locator('input[aria-label="Cantidad Única"]');
    await expect(cantidadChile).toBeVisible();
    await cantidadChile.fill('2');

    // 5. Confirmar venta
    const confirmarBtn = page.locator('button:has-text("Confirmar venta"):visible');
    await expect(confirmarBtn).toBeEnabled();
    await confirmarBtn.click({ force: true });
    await expect(page).toHaveURL(/\/ventas\/.*\/registrada/);
  });

  test('reporte diario, semanal y mensual muestra ventas, ingresos y gráfica', async ({ page }) => {
    await page.goto('/reportes');
    await expect(page.getByRole('heading', { name: 'Reportes', exact: true })).toBeVisible();

    // Vista semanal por defecto
    await expect(page.locator('text=Ventas totales')).toBeVisible();
    await expect(page.locator('text=Ingresos recibidos')).toBeVisible();
    await expect(page.locator('text=Ventas vs. ingresos reales')).toBeVisible();

    // Cambiar a Diario
    await page.locator('button.chip:has-text("Diario")').click();
    await expect(page.locator('td:has-text("Mañana")')).toBeVisible();

    // Cambiar a Mensual y navegar al mes anterior (siempre tiene 4-5 semanas)
    await page.locator('button.chip:has-text("Mensual")').click();
    const btnAnterior = page.locator('button[aria-label="Periodo anterior"]');
    await btnAnterior.click();
    await expect(page.locator('button[aria-label="Periodo siguiente"]')).toBeEnabled();
    await expect(page.locator('td:has-text("Sem 1")')).toBeVisible();
    await expect(page.locator('text=Ventas totales')).toBeVisible();
  });

  test('control sencillo de abonos y deudas permite abonar directo desde vista por cliente', async ({ page }) => {
    await page.goto('/deudas');
    await expect(page.getByRole('heading', { name: 'Deudas', exact: true })).toBeVisible();
    await expect(page.locator('text=Abonado hoy')).toBeVisible();

    // Vista Por cliente activa por defecto
    const btnPorCliente = page.getByRole('button', { name: 'Por cliente' });
    await expect(btnPorCliente).toHaveAttribute('aria-pressed', 'true');

    // Abonar directo sobre Juan Pérez
    const filaJuan = page.locator('article, tr').filter({ hasText: 'Juan Pérez' }).first();
    await expect(filaJuan).toBeVisible();
    await filaJuan.getByRole('button', { name: 'Abonar' }).click();

    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Registrar abono' })).toBeVisible();

    // Seleccionar atajo rápido de $500
    await sheet.locator('button.chip:has-text("$500")').click();
    const btnRegistrar = sheet.getByRole('button', { name: /Registrar abono de \$500/i });
    await expect(btnRegistrar).toBeEnabled();
    await btnRegistrar.click();

    // Verificar actualización inmediata, botón de comprobante y sección Últimos abonos
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.locator('text=Abono registrado · Juan Pérez')).toBeVisible();
    await expect(page.getByRole('button', { name: /Copiar comprobante/i })).toBeVisible();
    await expect(page.locator('section[aria-label="Últimos abonos"]')).toContainText('Juan Pérez');
  });
});
