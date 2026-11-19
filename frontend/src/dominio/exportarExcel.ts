import type { ResumenReportes } from '@micentralmx/shared/api';
import { formatoDia } from '../lib/fechas';
import { etiquetaSerieExport } from './reportesLocales';

interface CeldaExcel {
  valor: string | number;
  tipo: 'texto' | 'numero';
  estilo: number;
}

const ESTILO_NORMAL = 0;
const ESTILO_TITULO = 1;
const ESTILO_ENCABEZADO = 2;
const ESTILO_MONEDA = 3;
const ESTILO_ENTERO = 4;
const ESTILO_SUBTITULO = 5;
const ESTILO_MONEDA_DESTACADO = 6;

const TABLA_CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = TABLA_CRC32[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function nombreColumna(idx: number): string {
  let res = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    res = String.fromCharCode(65 + rem) + res;
    n = Math.floor((n - 1) / 26);
  }
  return res;
}

function crearArchivoZip(entradas: Array<{ nombre: string; contenido: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let offset = 0;

  for (const entrada of entradas) {
    const nombreBytes = encoder.encode(entrada.nombre);
    const datosBytes = encoder.encode(entrada.contenido);
    const crc = crc32(datosBytes);

    const local = new Uint8Array(30 + nombreBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x5421, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, datosBytes.length, true);
    lv.setUint32(22, datosBytes.length, true);
    lv.setUint16(26, nombreBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nombreBytes, 30);

    const central = new Uint8Array(46 + nombreBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, datosBytes.length, true);
    cv.setUint32(24, datosBytes.length, true);
    cv.setUint16(28, nombreBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nombreBytes, 46);

    locales.push(local, datosBytes);
    centrales.push(central);
    offset += local.length + datosBytes.length;
  }

  const cdSize = centrales.reduce((sum, b) => sum + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entradas.length, true);
  ev.setUint16(10, entradas.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + cdSize + eocd.length;
  const resultado = new Uint8Array(totalSize);
  let pos = 0;
  for (const parte of [...locales, ...centrales, eocd]) {
    resultado.set(parte, pos);
    pos += parte.length;
  }
  return resultado;
}

function construirFilasReporte(r: ResumenReportes, negocio: string): CeldaExcel[][] {
  const txt = (valor: string, estilo = ESTILO_NORMAL): CeldaExcel => ({ valor, tipo: 'texto', estilo });
  const num = (valor: string | number, estilo = ESTILO_MONEDA): CeldaExcel => ({
    valor: Number(valor),
    tipo: 'numero',
    estilo,
  });
  const encabezado = (...cols: string[]): CeldaExcel[] => cols.map((c) => txt(c, ESTILO_ENCABEZADO));
  const gran = { dia: 'Diario', semana: 'Semanal', mes: 'Mensual' }[r.granularidad];

  const filas: CeldaExcel[][] = [
    [txt(`Reporte de ventas e ingresos · ${negocio}`, ESTILO_TITULO)],
    [txt(`Periodo: ${formatoDia(r.desde)} al ${formatoDia(r.hasta)}`), txt(`Vista: ${gran}`)],
    [],
    encabezado('Concepto', 'Valor'),
    [txt('Ventas totales', ESTILO_SUBTITULO), num(r.ventas.total, ESTILO_MONEDA_DESTACADO)],
    [txt('Cantidad de ventas'), num(r.ventas.cantidad, ESTILO_ENTERO)],
    [txt('Ticket promedio'), num(r.ventasDetalle.ticketPromedio)],
    [txt('Contado efectivo'), num(r.ventasDetalle.contadoEfectivo)],
    [txt('Contado transferencia confirmada'), num(r.ventasDetalle.contadoTransferencia)],
    [txt('Transferencia por confirmar'), num(r.ventasDetalle.transferenciaPorConfirmar)],
    [txt('Ventas a crédito'), num(r.ventasDetalle.credito)],
    [txt('Ingresos reales totales', ESTILO_SUBTITULO), num(r.ingresosDetalle.totalIngresos, ESTILO_MONEDA_DESTACADO)],
    [txt('Abonos a deudas'), num(r.ingresosDetalle.abonosDeudas)],
    [txt('Otros ingresos'), num(r.ingresosDetalle.otrosIngresos)],
    [txt('Egresos'), num(r.ingresosDetalle.egresos)],
    [txt('Balance neto', ESTILO_SUBTITULO), num(r.ingresosDetalle.balanceNeto, ESTILO_MONEDA_DESTACADO)],
    [txt('Compras totales'), num(r.compras.total)],
    [txt('Por cobrar total'), num(r.deudas.porCobrar)],
    [txt('Saldo vencido'), num(r.deudas.vencido)],
    [txt('Mermas (valor aproximado)'), num(r.mermas.valor)],
    [],
    encabezado(
      'Desglose del periodo',
      'Desde',
      'Hasta',
      'Ventas (#)',
      'Ventas ($)',
      'Contado ($)',
      'Crédito ($)',
      'Abonos ($)',
      'Ingresos ($)',
      'Egresos ($)',
    ),
    ...r.serie.map((s): CeldaExcel[] => [
      txt(etiquetaSerieExport(r, s)),
      txt(formatoDia(s.desde)),
      txt(formatoDia(s.hasta)),
      num(s.cantidadVentas, ESTILO_ENTERO),
      num(s.ventasTotal),
      num(s.ventasContado),
      num(s.ventasCredito),
      num(s.abonos),
      num(s.ingresosTotal),
      num(s.egresos),
    ]),
  ];

  if (r.topProductos.length > 0) {
    filas.push([]);
    filas.push(encabezado('Productos más vendidos', 'Clasificación', 'Cantidad', 'Unidad', 'Importe ($)'));
    for (const p of r.topProductos) {
      filas.push([
        txt(p.nombre),
        txt(p.clasificacion),
        num(p.cantidad, ESTILO_NORMAL),
        txt(p.unidad),
        num(p.importe),
      ]);
    }
  }

  return filas;
}

function construirHojaXml(filas: CeldaExcel[][]): string {
  const maxAnchos: number[] = [];
  for (let filaIdx = 0; filaIdx < filas.length; filaIdx++) {
    const fila = filas[filaIdx];
    for (let colIdx = 0; colIdx < fila.length; colIdx++) {
      const celda = fila[colIdx];
      // La fila 0 tiene el título largo en A1; no ensanchamos la columna A más allá de lo necesario para datos.
      if (filaIdx === 0 && colIdx === 0) continue;
      const textoLen =
        celda.tipo === 'numero'
          ? celda.estilo === ESTILO_MONEDA || celda.estilo === ESTILO_MONEDA_DESTACADO
            ? `$${Number(celda.valor).toFixed(2)}`.length + 2
            : String(celda.valor).length + 2
          : String(celda.valor).length;
      maxAnchos[colIdx] = Math.max(maxAnchos[colIdx] ?? 12, textoLen);
    }
  }

  const colsXml = maxAnchos
    .map((ancho, i) => {
      const w = Math.min(44, Math.max(12, ancho + 4));
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
    })
    .join('');

  const rowsXml = filas
    .map((fila, rIdx) => {
      if (fila.length === 0) return `<row r="${rIdx + 1}"/>`;
      const celdasXml = fila
        .map((c, cIdx) => {
          const ref = `${nombreColumna(cIdx)}${rIdx + 1}`;
          if (c.tipo === 'numero') {
            return `<c r="${ref}" s="${c.estilo}"><v>${Number.isFinite(c.valor as number) ? c.valor : 0}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr" s="${c.estilo}"><is><t xml:space="preserve">${escaparXml(String(c.valor))}</t></is></c>`;
        })
        .join('');
      return `<row r="${rIdx + 1}">${celdasXml}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Reporte" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="#,##0"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF182C30"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF0B4F40"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF182C30"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF146C58"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF2F6F5"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF5EF"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFDAE5E0"/></left>
      <right style="thin"><color rgb="FFDAE5E0"/></right>
      <top style="thin"><color rgb="FFDAE5E0"/></top>
      <bottom style="thin"><color rgb="FFDAE5E0"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;

/** Genera un libro .xlsx OOXML nativo con formato moneda, encabezados y anchos automáticos. */
export function generarReporteXlsx(r: ResumenReportes, negocio = 'MiCentralMX'): Uint8Array {
  const filas = construirFilasReporte(r, negocio);
  const sheetXml = construirHojaXml(filas);
  return crearArchivoZip([
    { nombre: '[Content_Types].xml', contenido: CONTENT_TYPES_XML },
    { nombre: '_rels/.rels', contenido: RELS_XML },
    { nombre: 'xl/workbook.xml', contenido: WORKBOOK_XML },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: WORKBOOK_RELS_XML },
    { nombre: 'xl/styles.xml', contenido: STYLES_XML },
    { nombre: 'xl/worksheets/sheet1.xml', contenido: sheetXml },
  ]);
}

export function descargarReporteExcel(r: ResumenReportes, negocio = 'MiCentralMX'): void {
  const bytes = generarReporteXlsx(r, negocio);
  const copia = new Uint8Array(bytes.byteLength);
  copia.set(bytes);
  const blob = new Blob([copia.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-${r.desde}-${r.hasta}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
