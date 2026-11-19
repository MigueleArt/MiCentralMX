import { test, expect } from '@playwright/test';
import { iniciarSesionDemo } from './ayuda';

test.describe('E2E · Flujo de Venta Offline y Sincronización PWA (HU-054 a HU-057)', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Iniciar sesión con conexión activa para sincronizar semilla de datos y folios
    await iniciarSesionDemo(page);
    await expect(page.getByText('Jitomate Saladette', { exact: false }).first()).toBeVisible({ timeout: 15000 });
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

  test('permite registrar un movimiento de caja y un abono de cliente sin conexión y los sincroniza al reconectar', async ({
    page,
    context,
  }) => {
    await page.goto('/pagos');
    await expect(page.getByRole('heading', { name: 'Pagos', exact: true })).toBeVisible();
    await expect(page.locator('button.pagos-fila', { hasText: 'Abarrotes Doña Lupe' }).first()).toBeVisible();

    await context.setOffline(true);
    await expect(page.locator('text=Sin conexión').first()).toBeVisible({ timeout: 5000 });

    // 1. Registrar movimiento de caja offline
    await page.locator('button:has-text("Registrar movimiento"):visible').click();
    const sheetMov = page.locator('.sheet');
    await expect(sheetMov).toBeVisible();
    await sheetMov.getByRole('button', { name: 'Ingreso', exact: true }).click();
    await sheetMov.locator('#desc').fill('Ingreso caja offline');
    await sheetMov.locator('#monto').fill('275');
    await sheetMov.getByRole('button', { name: 'Registrar ingreso' }).click();
    await expect(sheetMov).toHaveCount(0);

    const filaCaja = page.locator('button.pagos-fila', { hasText: 'Ingreso caja offline' }).first();
    await expect(filaCaja).toBeVisible();
    await expect(filaCaja).toContainText('$275');
    await expect(filaCaja).toContainText('Sin sincronizar');

    // 2. Sin reconectar, navegar a /cobrar y registrar un abono
    await page.locator('a[href="/cobrar"]:visible').first().click();
    await expect(page).toHaveURL('/cobrar');
    await page.locator('button.rowlink', { hasText: 'Juan Pérez' }).first().click();

    const sheetAbono = page.locator('.sheet');
    await expect(sheetAbono).toBeVisible();
    await sheetAbono.locator('button.chip:has-text("$500")').click();
    await sheetAbono.getByRole('button', { name: /Registrar abono de \$500/i }).click();
    await expect(sheetAbono).toHaveCount(0);
    await expect(page.locator('text=Abono registrado correctamente')).toBeVisible();

    await page.locator('button[aria-label="Cerrar"]').click();
    await expect(page).toHaveURL('/pagos');

    await expect(page.locator('button.pagos-fila', { hasText: 'Ingreso caja offline' }).first()).toBeVisible();
    const filaAbono = page.locator('button.pagos-fila', { hasText: 'Juan Pérez' }).first();
    await expect(filaAbono).toBeVisible();
    await expect(filaAbono).toContainText('$500');
    await expect(filaAbono).toContainText('Sin sincronizar');

    // 3. Reconectar y verificar sincronización automática completa
    await context.setOffline(false);
    await expect(page.locator('.bdg:has-text("Sin sincronizar")')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('button[aria-label*="Sincronización"]')).toHaveAttribute('aria-label', /Actualizado/i, {
      timeout: 15000,
    });
    await expect(page.locator('button.pagos-fila', { hasText: 'Ingreso caja offline' }).first()).toContainText('+$275');
    await expect(page.locator('button.pagos-fila', { hasText: 'Juan Pérez' }).first()).toContainText('+$500');
  });
});
