import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { ProductoVista } from '../../dominio/consultas';
import { buscarProductosRapido, coincideTokens } from '../../dominio/buscarProductos';

function crearProducto(
  id: string,
  nombre: string,
  unidadNombre: string,
  unidadPlural: string,
  clasifs: Array<{ id: string; nombre: string; precio: string; existencia: number; orden: number }>,
): ProductoVista {
  const unidad = {
    id: `u-${id}`,
    nombre: unidadNombre,
    plural: unidadPlural,
    permiteDecimales: false,
    archivadoEn: null,
  };
  return {
    producto: { id, nombre, unidadId: unidad.id, umbralBajo: '10', archivadoEn: null },
    unidad,
    total: clasifs.reduce((a, c) => a.plus(c.existencia), new Decimal(0)),
    clasificaciones: clasifs.map((c) => ({
      clasificacion: {
        id: c.id,
        productoId: id,
        nombre: c.nombre,
        precio: c.precio,
        ultimoCosto: null,
        orden: c.orden,
        archivadoEn: null,
      },
      existencia: new Decimal(c.existencia),
      bajo: c.existencia > 0 && c.existencia <= 10,
      sinExistencia: c.existencia <= 0,
    })),
  };
}

const catalogoDemo: ProductoVista[] = [
  crearProducto('p1', 'Jitomate Saladette', 'tara', 'taras', [
    { id: 'c1', nombre: 'Primera / Grande', precio: '420.00', existencia: 80, orden: 0 },
    { id: 'c2', nombre: 'Segunda / Mediano', precio: '340.00', existencia: 0, orden: 1 },
  ]),
  crearProducto('p2', 'Aguacate Hass', 'caja', 'cajas', [
    { id: 'c3', nombre: 'Primera / Grande', precio: '650.00', existencia: 24, orden: 0 },
  ]),
  crearProducto('p3', 'Limón persa', 'caja', 'cajas', [
    { id: 'c4', nombre: 'Primera / Grande', precio: '560.00', existencia: 30, orden: 0 },
    { id: 'c5', nombre: 'Segunda / Mediano', precio: '500.00', existencia: 12, orden: 1 },
  ]),
];

describe('Buscador rápido de productos', () => {
  it('soporta búsqueda multi-término sin distinguir acentos o mayúsculas', () => {
    expect(coincideTokens('Limón persa Primera / Grande caja', 'LIMON   pri')).toBe(true);
    const res = buscarProductosRapido(catalogoDemo, 'jit pri');
    expect(res).toHaveLength(1);
    expect(res[0].producto.producto.nombre).toBe('Jitomate Saladette');
    expect(res[0].clasificacion.clasificacion.nombre).toBe('Primera / Grande');
  });

  it('permite filtrar combinando producto y unidad', () => {
    const res = buscarProductosRapido(catalogoDemo, 'limon caja');
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.producto.producto.id === 'p3')).toBe(true);
  });

  it('prioriza coincidencias con existencia disponible sobre sin existencia cuando empatan en relevancia', () => {
    const res = buscarProductosRapido(catalogoDemo, 'jitomate');
    expect(res.map((r) => r.clasificacion.clasificacion.id)).toEqual(['c1', 'c2']);
  });

  it('respeta el límite y devuelve vacío cuando no hay coincidencias', () => {
    expect(buscarProductosRapido(catalogoDemo, '', 2)).toHaveLength(2);
    expect(buscarProductosRapido(catalogoDemo, 'cebolla morada')).toEqual([]);
  });
});
