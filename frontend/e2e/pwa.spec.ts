import { test, expect } from '@playwright/test';

test.describe('Validación de PWA y Manifiesto', () => {
  test('la aplicación expone el manifiesto web con las propiedades requeridas', async ({ page }) => {
    await page.goto('/');

    // 1. Verificar enlace al manifiesto en el DOM (o esperar su presencia)
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1);


    // 2. Comprobar meta tags requeridos para PWA y móviles
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute('content', '#176B5B');

    const appleMobile = page.locator('meta[name="apple-mobile-web-app-capable"]');
    await expect(appleMobile).toHaveAttribute('content', 'yes');

    // 3. Obtener y parsear el manifest.webmanifest
    const response = await page.request.get('/manifest.webmanifest');
    expect(response.ok()).toBeTruthy();

    const manifest = await response.json();
    expect(manifest.name).toBe('MiCentralMX');
    expect(manifest.short_name).toBe('MiCentralMX');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('permite el inicio de sesión y navega al panel principal', async ({ page }) => {
    await page.goto('/login');

    // Llenar formulario de login (HU-001) usando los IDs reales de Login.tsx (#u y #p)
    await page.fill('#u', 'rodolfo');
    await page.fill('#p', 'demo1234');
    await page.click('button[type="submit"]');

    // Verificar navegación al inicio y visualización del botón principal
    await expect(page).toHaveURL('/');
    await expect(page.locator('text=Nueva venta')).toBeVisible();
  });
});
