import { test, expect, type Page } from '@playwright/test';
import { completarOnboarding } from './ayuda';

async function simularPwaInstalada(page: Page) {
  await page.addInitScript(() => {
    const matchMediaOriginal = window.matchMedia.bind(window);
    window.matchMedia = (consulta: string) => {
      const resultado = matchMediaOriginal(consulta);
      if (consulta === '(display-mode: standalone)') {
        Object.defineProperty(resultado, 'matches', { value: true });
      }
      return resultado;
    };
  });
}

async function iniciarSesion(page: Page, usuario: string) {
  await page.goto('/login');
  await page.fill('#u', usuario);
  await page.fill('#p', 'demo1234');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/');
}

test.describe('Validación de PWA y Manifiesto', () => {
  test('la aplicación expone el manifiesto web con las propiedades requeridas', async ({ page }) => {
    await page.goto('/');

    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1);

    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute('content', '#176B5B');

    const appleMobile = page.locator('meta[name="apple-mobile-web-app-capable"]');
    await expect(appleMobile).toHaveAttribute('content', 'yes');

    const response = await page.request.get('/manifest.webmanifest');
    expect(response.ok()).toBeTruthy();

    const manifest = await response.json();
    expect(manifest.name).toBe('MiCentralMX');
    expect(manifest.short_name).toBe('MiCentralMX');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('en el navegador normal entra directamente al panel', async ({ page }) => {
    await iniciarSesion(page, 'rodolfo');

    await expect(page.getByRole('heading', { name: 'Bienvenido a MiCentralMX' })).toHaveCount(0);
    await expect(page.locator('text=Nueva venta')).toBeVisible();
  });

  test('muestra el onboarding al Dueño en la PWA móvil instalada una sola vez', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile Chrome', 'Este flujo solo corresponde a dispositivos móviles.');
    await simularPwaInstalada(page);
    await iniciarSesion(page, 'rodolfo');

    await expect(page.getByRole('heading', { name: 'Bienvenido a MiCentralMX' })).toBeVisible();
    await completarOnboarding(page);
    await expect(page.locator('text=Nueva venta')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Bienvenido a MiCentralMX' })).toHaveCount(0);
    await expect(page.locator('text=Nueva venta')).toBeVisible();
  });

  test('no muestra el onboarding a un Administrador aunque use la PWA móvil instalada', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Mobile Chrome', 'Este flujo solo corresponde a dispositivos móviles.');
    await simularPwaInstalada(page);
    await iniciarSesion(page, 'ana');

    await expect(page.getByRole('heading', { name: 'Bienvenido a MiCentralMX' })).toHaveCount(0);
    await expect(page.locator('text=Nueva venta')).toBeVisible();
  });
});
