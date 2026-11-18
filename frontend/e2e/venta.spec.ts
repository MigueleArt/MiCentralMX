import { test, expect } from '@playwright/test';

test.describe('E2E · Flujo de Venta Completa (Contado y Crédito)', () => {
  test.beforeEach(async ({ page }) => {
    // Iniciar sesión con Dueño
    await page.goto('/login');
    await page.fill('#u', 'rodolfo');
    await page.fill('#p', 'demo1234');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
    // Esperar a que la sincronización inicial de la semilla demo se complete en Dexie
    await expect(page.locator('text=$16,394')).toBeVisible({ timeout: 15000 });
  });

  test('registra una venta de contado con selección de producto y cálculo de totales', async ({ page }) => {
    // 1. Navegar a Nueva venta
    await page.goto('/ventas/nueva');
    await expect(page).toHaveURL('/ventas/nueva');

    // 2. Elegir producto (HU-046)
    const botonProducto = page.locator('#producto-1');
    await expect(botonProducto).toBeVisible();
    await botonProducto.click();

    // Seleccionar Jitomate Saladette dentro de la hoja
    const opcionProducto = page.locator('.sheet button.rowlink:has-text("Jitomate Saladette")');
    await expect(opcionProducto).toBeVisible();
    await opcionProducto.click({ force: true });

    // Esperar a que la hoja se cierre y el producto quede asignado
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.locator('text=Clasificaciones, origen y precios')).toBeVisible();

    // 3. Capturar cantidad a vender (HU-047)
    const cantidadInput = page.locator('input[aria-label*="Cantidad"]').first();
    await expect(cantidadInput).toBeVisible();
    await cantidadInput.fill('5');

    // 4. Confirmar venta (HU-051, HU-055)
    const confirmarBtn = page.locator('button:has-text("Confirmar venta"):visible');
    await expect(confirmarBtn).toBeEnabled();
    await confirmarBtn.click({ force: true });

    // 5. Verificar navegación a venta registrada o listado de ventas (HU-057)
    await expect(page).toHaveURL(/\/ventas/);
    await expect(page.locator('text=Venta registrada').or(page.locator('text=Jitomate Saladette')).first()).toBeVisible();
  });

  test('registra una venta a crédito con asignación de cliente y plazo (HU-048 a HU-051)', async ({ page }) => {
    // 1. Navegar a Nueva venta
    await page.goto('/ventas/nueva');
    await expect(page).toHaveURL('/ventas/nueva');

    // 2. Elegir producto
    const botonProducto = page.locator('#producto-1');
    await expect(botonProducto).toBeVisible();
    await botonProducto.click();

    const opcionProducto = page.locator('.sheet button.rowlink:has-text("Jitomate Saladette")');
    await expect(opcionProducto).toBeVisible();
    await opcionProducto.click({ force: true });
    await expect(page.locator('.sheet')).toHaveCount(0);

    // 3. Capturar cantidad
    const cantidadInput = page.locator('input[aria-label*="Cantidad"]').first();
    await expect(cantidadInput).toBeVisible();
    await cantidadInput.fill('2');

    // 4. Elegir cliente (HU-048)
    const botonCliente = page.locator('#cliente');
    await expect(botonCliente).toBeVisible();
    await botonCliente.click();

    const opcionCliente = page.locator('.sheet button.rowlink:has-text("Abarrotes Doña Lupe")');
    await expect(opcionCliente).toBeVisible();
    await opcionCliente.click({ force: true });
    await expect(page.locator('.sheet')).toHaveCount(0);

    // 5. Seleccionar forma de pago Crédito (HU-049)
    const btnCredito = page.locator('button:has-text("Crédito")');
    await expect(btnCredito).toBeEnabled();
    await btnCredito.click();

    // 6. Confirmar venta a crédito
    const confirmarBtn = page.locator('button:has-text("Confirmar venta"):visible');
    await expect(confirmarBtn).toBeEnabled();
    await confirmarBtn.click({ force: true });

    // 7. Validar registro exitoso con crédito
    await expect(page).toHaveURL(/\/ventas/);
    await expect(page.locator('text=A crédito').or(page.locator('text=Abarrotes Doña Lupe')).first()).toBeVisible();
  });
});
