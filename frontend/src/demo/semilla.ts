/**
 * Datos de prueba del servidor de demostración (solo `--mode demo`).
 * Reproducen el negocio del prototipo UI/UX; las fechas se calculan respecto a hoy.
 */
import type {
  Clasificacion,
  Cliente,
  Compra,
  MovimientoDinero,
  MovimientoInventario,
  Pago,
  Producto,
  Proveedor,
  RenglonVenta,
  Unidad,
  Venta,
} from '@micentralmx/shared/entidades';
import { ROLES_BASE } from '@micentralmx/shared/permisos';
import { aImporte, D } from '../lib/dinero';
import { diaLocal, sumarDias } from '../lib/fechas';
import { nuevoId } from '../lib/ids';

export const CONTRASENA_DEMO = 'demo1234';

export interface UsuarioServidor {
  id: string;
  nombre: string;
  usuario: string;
  contrasena: string;
  rolId: string;
  activo: boolean;
  ultimaActividad: string | null;
}

export interface RolServidor {
  id: string;
  nombre: string;
  base: string | null;
  permisos: string[];
  editable: boolean;
}

export interface AuditoriaServidor {
  id: string;
  fecha: string;
  usuarioNombre: string;
  categoria: string;
  descripcion: string;
}

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const haceDias = (dias: number, hora = 10) => {
  const f = new Date(`${sumarDias(diaLocal(), -dias)}T${String(hora).padStart(2, '0')}:00:00-06:00`);
  return f.toISOString();
};

export function crearSemilla() {
  const hoy = diaLocal();
  const unidades: Unidad[] = [
    ['caja', 'cajas', false],
    ['kg', 'kg', true],
    ['pieza', 'piezas', false],
    ['costal', 'costales', false],
    ['arpilla', 'arpillas', false],
    ['tara', 'taras', false],
    ['libra', 'libras', true],
  ].map(([nombre, plural, dec]) => ({ id: nuevoId(), nombre: nombre as string, plural: plural as string, permiteDecimales: dec as boolean, archivadoEn: null }));
  const u = (n: string) => unidades.find((x) => x.nombre === n)!;

  const productos: Producto[] = [];
  const clasificaciones: Clasificacion[] = [];
  const existencias: Array<{ clasificacionId: string; cantidad: string }> = [];
  const clas: Record<string, Clasificacion> = {};
  const agregar = (nombre: string, unidad: string, umbral: string, filas: Array<[string, string, number, string]>) => {
    const p: Producto = { id: nuevoId(), nombre, unidadId: u(unidad).id, umbralBajo: umbral, archivadoEn: null };
    productos.push(p);
    filas.forEach(([cn, precio, existencia, costo], orden) => {
      const c: Clasificacion = { id: nuevoId(), productoId: p.id, nombre: cn, precio, ultimoCosto: costo, orden, archivadoEn: null };
      clasificaciones.push(c);
      clas[`${nombre}|${cn}`] = c;
      existencias.push({ clasificacionId: c.id, cantidad: String(existencia) });
    });
    return p;
  };
  agregar('Jitomate Saladette', 'caja', '15', [
    ['Primera / Grande', '420.00', 80, '300.00'],
    ['Segunda / Mediano', '340.00', 35, '250.00'],
    ['Tercera / Chico', '260.00', 12, '180.00'],
  ]);
  agregar('Aguacate Hass', 'caja', '10', [
    ['Primera / Grande', '650.00', 24, '520.00'],
    ['Segunda / Mediano', '480.00', 6, '380.00'],
  ]);
  agregar('Chile serrano', 'kg', '20', [['Única', '38.00', 140, '46.00']]);
  agregar('Limón persa', 'caja', '10', [
    ['Primera / Grande', '560.00', 30, '420.00'],
    ['Segunda / Mediano', '500.00', 18, '350.00'],
  ]);
  agregar('Cebolla blanca', 'arpilla', '5', [['Primera', '390.00', 0, '300.00']]);

  const roles: RolServidor[] = (Object.keys(ROLES_BASE) as Array<keyof typeof ROLES_BASE>).map((base) => ({
    id: nuevoId(),
    nombre: ROLES_BASE[base].nombre,
    base,
    permisos: [...ROLES_BASE[base].permisos],
    editable: base !== 'dueno',
  }));
  const rol = (b: string) => roles.find((r) => r.base === b)!.id;
  const usuarios: UsuarioServidor[] = [
    { id: nuevoId(), nombre: 'Rodolfo Hernández', usuario: 'rodolfo', contrasena: CONTRASENA_DEMO, rolId: rol('dueno'), activo: true, ultimaActividad: hace(60 * 30) },
    { id: nuevoId(), nombre: 'Ana Hernández', usuario: 'ana', contrasena: CONTRASENA_DEMO, rolId: rol('administrador'), activo: true, ultimaActividad: hace(1) },
    { id: nuevoId(), nombre: 'Carlos Mendoza', usuario: 'carlos', contrasena: CONTRASENA_DEMO, rolId: rol('trabajador'), activo: true, ultimaActividad: hace(10) },
    { id: nuevoId(), nombre: 'Luis García', usuario: 'luis', contrasena: CONTRASENA_DEMO, rolId: rol('trabajador'), activo: true, ultimaActividad: hace(60 * 24) },
  ];
  const [rodolfo, ana, carlos] = usuarios;

  const clientes: Cliente[] = [
    ['Juan Pérez', '55 1234 5678', 'Puesto 112, Nave I', 14, 220],
    ['Fonda El Comal', '55 2345 6789', 'Col. Santa Cruz Meyehualco', 14, 160],
    ['Abarrotes Doña Lupe', '55 3456 7890', 'Mercado de Jamaica, local 45', 5, 400],
    ['Frutería Los Arcos', '55 4567 8901', 'Av. Ermita Iztapalapa 2100', 14, 300],
    ['Cocina Económica Rosy', '55 5678 9012', 'Calle 7 núm. 18, Agrícola Oriental', 7, 90],
    ['Mercado Sobre Ruedas Iztapalapa', '55 6789 0123', 'Ruta martes y viernes', 21, 500],
  ].map(([nombre, telefono, ubicacion, plazo, dias]) => ({
    id: nuevoId(),
    nombre: nombre as string,
    telefono: telefono as string,
    ubicacion: ubicacion as string,
    plazoDias: plazo as number,
    saldoAFavor: '0.00',
    creadoEn: haceDias(dias as number),
    archivadoEn: null,
    requiereRevision: false,
  }));
  const cli = (n: string) => clientes.find((c) => c.nombre.startsWith(n))!;

  const proveedores: Proveedor[] = [
    ['Agrícola San Juan', '228 123 4567', 'Jitomate, chile serrano'],
    ['Huertas de Michoacán', '452 234 5678', 'Aguacate Hass'],
    ['Cítricos del Golfo', '229 345 6789', 'Limón persa'],
    ['Productores Unidos de Puebla', '222 456 7890', 'Cebolla, papa'],
  ].map(([nombre, telefono, prods]) => ({ id: nuevoId(), nombre, telefono, productos: prods, archivadoEn: null }));
  const prov = (n: string) => proveedores.find((p) => p.nombre.startsWith(n))!;

  const renglon = (prod: string, cn: string, cantidad: number): RenglonVenta => {
    const c = clas[`${prod}|${cn}`];
    const p = productos.find((x) => x.id === c.productoId)!;
    const un = unidades.find((x) => x.id === p.unidadId)!;
    return {
      clasificacionId: c.id,
      productoId: p.id,
      productoNombre: prod,
      clasificacionNombre: cn,
      unidadNombre: un.nombre,
      unidadPlural: un.plural,
      cantidad: String(cantidad),
      precio: c.precio,
      precioReferencia: c.precio,
      importe: aImporte(D(c.precio).times(cantidad)),
    };
  };

  const ventas: Venta[] = [];
  const venta = (
    folio: number,
    fecha: string,
    renglones: RenglonVenta[],
    opts: { cliente?: Cliente; forma?: Venta['formaPago']; vence?: string; pagado?: string; estado?: Venta['estado']; usuario?: UsuarioServidor },
  ) => {
    const total = renglones.reduce((a, r) => a.plus(r.importe), D(0));
    const forma = opts.forma ?? 'efectivo';
    const pagado = D(opts.pagado ?? 0);
    const v: Venta = {
      id: nuevoId(),
      folio,
      folioProvisional: null,
      clienteId: opts.cliente?.id ?? null,
      clienteNombre: opts.cliente?.nombre ?? null,
      formaPago: forma,
      estado: opts.estado ?? (forma === 'credito' ? (pagado.gte(total) ? 'completada' : 'a_credito') : 'completada'),
      renglones,
      total: aImporte(total),
      pagado: forma === 'credito' ? aImporte(pagado) : '0.00',
      venceEl: opts.vence ?? null,
      usuarioId: (opts.usuario ?? carlos).id,
      usuarioNombre: (opts.usuario ?? carlos).nombre,
      dispositivoId: 'servidor',
      creadoEnDispositivo: fecha,
      requiereRevision: false,
      motivoRevision: null,
      canceladaEn: opts.estado === 'cancelada' ? fecha : null,
    };
    ventas.push(v);
    return v;
  };

  const v98 = venta(98, haceDias(30, 9), [renglon('Aguacate Hass', 'Primera / Grande', 5), renglon('Limón persa', 'Segunda / Mediano', 1)], {
    cliente: cli('Juan'), forma: 'credito', vence: sumarDias(hoy, -16), pagado: '1000',
  });
  venta(104, haceDias(23, 11), [renglon('Jitomate Saladette', 'Primera / Grande', 5), renglon('Chile serrano', 'Única', 50)], {
    cliente: cli('Fonda'), forma: 'credito', vence: sumarDias(hoy, -9),
  });
  venta(111, haceDias(17, 12), [renglon('Limón persa', 'Primera / Grande', 5), renglon('Jitomate Saladette', 'Tercera / Chico', 1)], {
    cliente: cli('Frutería'), forma: 'credito', vence: sumarDias(hoy, -3),
  });
  venta(117, haceDias(2, 8), [renglon('Aguacate Hass', 'Segunda / Mediano', 5), renglon('Jitomate Saladette', 'Tercera / Chico', 4)], {
    cliente: cli('Mercado'), forma: 'credito', vence: sumarDias(hoy, 19),
  });
  venta(120, hace(390), [renglon('Jitomate Saladette', 'Segunda / Mediano', 2)], { usuario: ana });
  venta(121, hace(330), [renglon('Chile serrano', 'Única', 25), renglon('Limón persa', 'Segunda / Mediano', 2)], {
    cliente: cli('Cocina'), forma: 'credito', vence: sumarDias(hoy, 7),
  });
  venta(122, hace(270), [renglon('Limón persa', 'Primera / Grande', 4), renglon('Jitomate Saladette', 'Primera / Grande', 2)], {
    cliente: cli('Frutería'), forma: 'transferencia',
  });
  venta(123, hace(225), [renglon('Aguacate Hass', 'Primera / Grande', 3), renglon('Jitomate Saladette', 'Tercera / Chico', 2)], {
    cliente: cli('Juan'), forma: 'efectivo',
  });
  venta(124, hace(200), [renglon('Jitomate Saladette', 'Primera / Grande', 1)], { estado: 'cancelada' });
  venta(125, hace(178), [renglon('Chile serrano', 'Única', 26)], { cliente: cli('Fonda'), forma: 'transferencia', estado: 'por_confirmar' });
  venta(126, hace(160), [renglon('Jitomate Saladette', 'Segunda / Mediano', 5), renglon('Chile serrano', 'Única', 20)], {
    cliente: cli('Juan'), forma: 'transferencia',
  });
  const v127 = venta(127, hace(132), [renglon('Aguacate Hass', 'Primera / Grande', 4), renglon('Limón persa', 'Segunda / Mediano', 2)], {
    cliente: cli('Abarrotes'), forma: 'credito', vence: sumarDias(hoy, 5), pagado: '1000',
  });
  venta(128, hace(115), [renglon('Jitomate Saladette', 'Tercera / Chico', 2), renglon('Chile serrano', 'Única', 17)], {});

  // Montos de importe pueden no ser redondos por los kilos; se redondean a 2 decimales.
  ventas.forEach((v) => (v.total = aImporte(v.total)));

  const pagos: Pago[] = [
    {
      id: nuevoId(), clienteId: v98.clienteId!, clienteNombre: v98.clienteNombre!, monto: '1000.00', metodo: 'transferencia', nota: null,
      aplicaciones: [{ ventaId: v98.id, monto: '1000.00' }], excedente: '0.00', usuarioId: carlos.id, usuarioNombre: carlos.nombre,
      creadoEnDispositivo: haceDias(28, 11), requiereRevision: false,
    },
    {
      id: nuevoId(), clienteId: v127.clienteId!, clienteNombre: v127.clienteNombre!, monto: '1000.00', metodo: 'efectivo', nota: 'Anticipo',
      aplicaciones: [{ ventaId: v127.id, monto: '1000.00' }], excedente: '0.00', usuarioId: carlos.id, usuarioNombre: carlos.nombre,
      creadoEnDispositivo: hace(120), requiereRevision: false,
    },
  ];

  const compra = (folio: number, minutos: number, proveedor: Proveedor, prod: string, cn: string, cantidad: number): Compra => {
    const r = renglon(prod, cn, cantidad);
    const costo = clas[`${prod}|${cn}`].ultimoCosto!;
    return {
      id: nuevoId(), folio, folioProvisional: null, proveedorId: proveedor.id, proveedorNombre: proveedor.nombre,
      renglones: [{ ...r, costo, importe: aImporte(D(costo).times(cantidad)) }],
      total: aImporte(D(costo).times(cantidad)), formaPago: 'contado', venceEl: null,
      usuarioId: rodolfo.id, usuarioNombre: rodolfo.nombre, creadoEnDispositivo: hace(minutos),
    };
  };
  const compras: Compra[] = [
    compra(43, 640, prov('Agrícola'), 'Chile serrano', 'Única', 50),
    compra(44, 605, prov('Cítricos'), 'Limón persa', 'Segunda / Mediano', 12),
    compra(45, 570, prov('Agrícola'), 'Jitomate Saladette', 'Primera / Grande', 60),
  ];

  const movimientosInventario: MovimientoInventario[] = [];
  for (const c of compras) {
    for (const r of c.renglones) {
      movimientosInventario.push({
        id: nuevoId(), clasificacionId: r.clasificacionId, productoId: r.productoId, delta: r.cantidad, tipo: 'compra',
        referencia: `Compra #C-${String(c.folio).padStart(4, '0')}`, motivo: null, usuarioNombre: c.usuarioNombre, creadoEn: c.creadoEnDispositivo,
      });
    }
  }
  for (const v of ventas.filter((x) => x.estado !== 'cancelada')) {
    for (const r of v.renglones) {
      movimientosInventario.push({
        id: nuevoId(), clasificacionId: r.clasificacionId, productoId: r.productoId, delta: D(r.cantidad).neg().toString(), tipo: 'venta',
        referencia: `Venta #${String(v.folio).padStart(6, '0')}`, motivo: null, usuarioNombre: v.usuarioNombre, creadoEn: v.creadoEnDispositivo,
      });
    }
  }
  const merma = (prod: string, cn: string, cantidad: number, motivo: string, fecha: string) => {
    const c = clas[`${prod}|${cn}`];
    movimientosInventario.push({
      id: nuevoId(), clasificacionId: c.id, productoId: c.productoId, delta: String(-cantidad), tipo: 'merma',
      referencia: null, motivo, usuarioNombre: ana.nombre, creadoEn: fecha,
    });
  };
  merma('Jitomate Saladette', 'Segunda / Mediano', 3, 'Producto dañado', haceDias(1, 15));
  merma('Aguacate Hass', 'Segunda / Mediano', 2, 'Maduración excesiva', haceDias(1, 12));
  const ajuste = clas['Limón persa|Primera / Grande'];
  movimientosInventario.push({
    id: nuevoId(), clasificacionId: ajuste.id, productoId: ajuste.productoId, delta: '4', tipo: 'ajuste',
    referencia: null, motivo: 'Conteo físico', usuarioNombre: ana.nombre, creadoEn: haceDias(3, 18),
  });

  // Existencia inicial: el historial debe explicar cada existencia (conciliación, decisiones técnicas §4.4).
  for (const e of existencias) {
    const c = clasificaciones.find((x) => x.id === e.clasificacionId)!;
    const suma = movimientosInventario.filter((m) => m.clasificacionId === c.id).reduce((a, m) => a.plus(m.delta), D(0));
    const inicial = D(e.cantidad).minus(suma);
    if (!inicial.isZero()) {
      movimientosInventario.unshift({
        id: nuevoId(), clasificacionId: c.id, productoId: c.productoId, delta: inicial.toString(), tipo: 'inicial',
        referencia: null, motivo: 'Existencia inicial', usuarioNombre: rodolfo.nombre, creadoEn: haceDias(45, 7),
      });
    }
  }

  const movimientosDinero: MovimientoDinero[] = [
    { id: nuevoId(), tipo: 'egreso', categoria: 'pago_proveedor', concepto: 'Pago a proveedor · Agrícola San Juan', monto: '4000.00', metodo: 'transferencia', proveedorId: prov('Agrícola').id, usuarioNombre: rodolfo.nombre, creadoEn: hace(560) },
    { id: nuevoId(), tipo: 'egreso', categoria: 'flete', concepto: 'Flete de mercancía', monto: '800.00', metodo: 'efectivo', proveedorId: null, usuarioNombre: rodolfo.nombre, creadoEn: hace(600) },
    { id: nuevoId(), tipo: 'ingreso', categoria: 'renta', concepto: 'Renta de diablitos', monto: '300.00', metodo: 'efectivo', proveedorId: null, usuarioNombre: ana.nombre, creadoEn: haceDias(1, 13) },
  ];

  const auditoria: AuditoriaServidor[] = [
    { id: nuevoId(), fecha: hace(120), usuarioNombre: carlos.nombre, categoria: 'pagos', descripcion: `${carlos.nombre} registró un pago de $1,000 de Abarrotes Doña Lupe` },
    { id: nuevoId(), fecha: hace(115), usuarioNombre: carlos.nombre, categoria: 'ventas', descripcion: `${carlos.nombre} registró la venta #000128` },
    { id: nuevoId(), fecha: hace(200), usuarioNombre: ana.nombre, categoria: 'ventas', descripcion: `${ana.nombre} canceló la venta #000124` },
    { id: nuevoId(), fecha: hace(420), usuarioNombre: ana.nombre, categoria: 'catalogo', descripcion: `${ana.nombre} cambió el precio de Jitomate Saladette Primera / Grande de $400 a $420` },
    { id: nuevoId(), fecha: hace(570), usuarioNombre: rodolfo.nombre, categoria: 'compras', descripcion: `${rodolfo.nombre} registró la compra #C-0045 de Agrícola San Juan` },
  ];

  return {
    negocio: { id: nuevoId(), nombre: 'Bodega Hernández', ubicacion: 'Nave I' },
    configuracion: { ventanaOfflineHoras: 24, plazoCreditoDias: 7 },
    unidades,
    productos,
    clasificaciones,
    existencias,
    clientes,
    proveedores,
    ventas,
    pagos,
    compras,
    movimientosInventario,
    movimientosDinero,
    usuarios,
    roles,
    auditoria,
    siguienteFolio: { venta: 129, compra: 46 },
  };
}
