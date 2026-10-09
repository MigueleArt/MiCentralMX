import 'fake-indexeddb/auto';

// Node expone `navigator` sin `onLine`; las pruebas simulan un dispositivo conectado.
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true, writable: true });
