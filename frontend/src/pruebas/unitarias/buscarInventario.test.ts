import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import type { ProductoVista } from '../../dominio/consultas';
import { buscarInventario } from '../../dominio/buscarInventario';

const producto: ProductoVista = {
  producto: { id: 'p1', nombre: 'Limón', unidadId: 'u1', umbralBajo: '5', archivadoEn: null },
  unidad: { id: 'u1', nombre: 'caja', plural: 'cajas', permiteDecimales: false, archivadoEn: null },
  total: new Decimal(20),
  clasificaciones: ['Primera', 'Segunda', 'Tercera'].map((nombre, i) => ({
    clasificacion: { id: `c${i}`, productoId: 'p1', nombre, precio: '100', ultimoCosto: null, orden: i, archivadoEn: null },
    existencia: new Decimal(i === 0 ? 20 : 0), bajo: i > 0, sinExistencia: i > 0,
  })),
};

describe('Búsqueda de inventario por clasificación', () => {
  it('encuentra nombres sin distinguir acentos o mayúsculas', () => {
    expect(buscarInventario([producto], '  LIMON  ', 'todos')[0].clasificaciones).toHaveLength(3);
  });
  it('muestra solo la clasificación solicitada', () => {
    expect(buscarInventario([producto], 'segunda', 'todos')[0].clasificaciones.map(c => c.clasificacion.nombre)).toEqual(['Segunda']);
  });
  it('no muestra clasificaciones disponibles al filtrar sin existencia', () => {
    expect(buscarInventario([producto], '', 'sin')[0].clasificaciones.map(c => c.clasificacion.nombre)).toEqual(['Segunda', 'Tercera']);
    expect(buscarInventario([producto], 'Primera', 'bajo')).toEqual([]);
  });
  it('no altera el catálogo original y devuelve vacío si no coincide', () => {
    buscarInventario([producto], '', 'bajo');
    expect(producto.clasificaciones).toHaveLength(3);
    expect(buscarInventario([producto], 'aguacate', 'todos')).toEqual([]);
  });
});
