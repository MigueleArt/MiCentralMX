import { test, expect } from '@playwright/test';

test.describe('E2E · Flujo de Venta Offline y Sincronización PWA (HU-054 a HU-057)', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Iniciar sesión con conexión activa para sincronizar semilla de datos y folios
    await page.goto('/login');
    await page.fill('#u', 'rodolfo');
    await page.fill('#p', 'demo1234');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/');
    await expect(page.locator('text=$16,394')).toBeVisible({ timeout: 15000 });
  });

  test('permite registrar una venta sin conexión a Internet y la sincroniza al reconectar', async ({ page, context }) => {
    // 2. Entrar a la pantalla de Nueva venta
    await page.goto('/ventas/nueva');
    await expect(page).toHaveURL('/ventas/nueva');

    // 3. Simular pérdida de conexión a Internet (HU-054)
    await context.setOffline(true);

    // Verificar que la aplicación detecta el estado offline en el encabezado
    await expect(page.locator('text=Sin conexión').first()).toBeVisible({ timeout: 5000 });

    // 4. Seleccionar producto disponible en el almacenamiento local
    const botonProducto = page.locator('#producto-1');
    await expect(botonProducto).toBeVisible();
    await botonProducto.click();

    const opcionProducto = page.locator('.sheet button.rowlink:has-text("Jitomate Saladette")');
    await expect(opcionProducto).toBeVisible();
    await opcionProducto.click({ force: true });
    await expect(page.locator('.sheet')).toHaveCount(0);

    // 5. Capturar cantidad (3 taras)
    const cantidadInput = page.locator('input[aria-label*="Cantidad"]').first();
    await expect(cantidadInput).toBeVisible();
    await cantidadInput.fill('3');

    // 6. Confirmar venta sin conexión (HU-055 / HU-056)
    const confirmarBtn = page.locator('button:has-text("Confirmar venta"):visible');
    await expect(confirmarBtn).toBeEnabled();
    await confirmarBtn.click({ force: true });

    // 7. Validar mensaje de venta guardada en el dispositivo (HU-057)
    await expect(page).toHaveURL(/\/ventas\/.*\/registrada/);
    await expect(page.locator('text=Venta registrada correctamente')).toBeVisible();
    await expect(page.locator('text=Guardada en este dispositivo')).toBeVisible();

    // 8. Restaurar conectividad a Internet
    await context.setOffline(false);

    // 9. Ir al listado de ventas y verificar que la venta offline sincronizada aparezca
    await page.locator('text=Ir a ventas').click();
    await expect(page).toHaveURL('/ventas');
    await expect(page.locator('button[aria-label*="Sincronización"]')).toBeVisible();
    await expect(page.locator('text=$1,260').first()).toBeVisible();
  });
});
