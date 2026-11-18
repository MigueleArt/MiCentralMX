import 'fake-indexeddb/auto';

// Node expone `navigator` sin `onLine` ni `userAgent` en todas las versiones; las pruebas simulan un dispositivo conectado.
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true, userAgent: 'Vitest/Node' },
    configurable: true,
    writable: true,
  });
} else {
  Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true, writable: true });
  if (!globalThis.navigator.userAgent) {
    Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Vitest/Node', configurable: true, writable: true });
  }
}


