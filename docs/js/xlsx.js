// Escribe archivos .xlsx sin dependencias. Un .xlsx es un ZIP con unas pocas hojas XML; aquí va solo lo que la página
// necesita: texto, números con formato (índice, porcentaje, variación y fecha), encabezado en negrita y fijo, y ancho
// de columnas. Sin DOM: se prueba con node --test.

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const codificar = new TextEncoder();

// el índice de cada formato en <cellXfs> de styles.xml
const ESTILOS = { texto: 0, encabezado: 1, indice: 2, porcentaje: 3, variacion: 4, fecha: 5, decimal2: 6 };
const MS_DIA = 86_400_000;
const CERO_EXCEL = Date.UTC(1899, 11, 30); // día 0 de las fechas de Excel

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

/** El CRC-32 de ZIP. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function unir(partes) {
  const total = new Uint8Array(partes.reduce((suma, parte) => suma + parte.length, 0));
  let posicion = 0;
  for (const parte of partes) {
    total.set(parte, posicion);
    posicion += parte.length;
  }
  return total;
}

/** Un ZIP sin compresión con `archivos` ({ nombre, contenido: Uint8Array }), en ese orden. */
export function zip(archivos) {
  const locales = [];
  const central = [];
  let desplazamiento = 0;
  for (const { nombre, contenido } of archivos) {
    const nombreBytes = codificar.encode(nombre);
    const crc = crc32(contenido);
    // encabezado local: firma, versión, banderas (nombres en UTF-8), sin compresión, fecha 1-ene-1980, crc y tamaños
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, contenido.length, true);
    local.setUint32(22, contenido.length, true);
    local.setUint16(26, nombreBytes.length, true);
    locales.push(new Uint8Array(local.buffer), nombreBytes, contenido);
    // la misma entrada en el directorio central, con dónde empieza
    const entrada = new DataView(new ArrayBuffer(46));
    entrada.setUint32(0, 0x02014b50, true);
    entrada.setUint16(4, 20, true);
    entrada.setUint16(6, 20, true);
    entrada.setUint16(8, 0x0800, true);
    entrada.setUint16(14, 0x21, true);
    entrada.setUint32(16, crc, true);
    entrada.setUint32(20, contenido.length, true);
    entrada.setUint32(24, contenido.length, true);
    entrada.setUint16(28, nombreBytes.length, true);
    entrada.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(entrada.buffer), nombreBytes);
    desplazamiento += 30 + nombreBytes.length + contenido.length;
  }
  const tamanoCentral = central.reduce((suma, parte) => suma + parte.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamanoCentral, true);
  fin.setUint32(16, desplazamiento, true);
  return unir([...locales, ...central, new Uint8Array(fin.buffer)]);
}

/** Texto seguro dentro de XML: sin caracteres de control y con &, <, > y " escapados. */
export function escaparXml(texto) {
  const MAPA = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  return String(texto).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"]/g, (c) => MAPA[c]);
}

/** "aaaa-mm-dd" → el número de día de Excel. */
export function diaExcel(fecha) {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return (Date.UTC(anio, mes - 1, dia) - CERO_EXCEL) / MS_DIA;
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columna(indice) {
  let letras = "";
  for (let n = indice + 1; n > 0; n = Math.floor((n - 1) / 26)) letras = String.fromCharCode(65 + ((n - 1) % 26)) + letras;
  return letras;
}

function celda(valor, ref, enEncabezado) {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") {
    const estilo = enEncabezado ? ESTILOS.encabezado : ESTILOS.texto;
    return `<c r="${ref}" t="inlineStr" s="${estilo}"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
  }
  const { valor: dato, formato } = typeof valor === "number" ? { valor, formato: null } : valor;
  if (dato === null || dato === undefined) return "";
  const numero = formato === "fecha" ? diaExcel(dato) : dato;
  if (!Number.isFinite(numero)) return "";
  return `<c r="${ref}" s="${ESTILOS[formato] ?? ESTILOS.texto}"><v>${numero}</v></c>`;
}

function anchoDe(valor) {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === "string") return valor.length;
  return valor.formato === "fecha" ? 11 : 10;
}

function hojaXml({ filas, encabezado = true }) {
  const columnas = Math.max(...filas.map((fila) => fila.length));
  const anchos = Array.from({ length: columnas }, (_, i) =>
    Math.min(60, Math.max(8, ...filas.map((fila) => anchoDe(fila[i]) + 2))),
  );
  const cols = anchos.map((ancho, i) => `<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"/>`).join("");
  const fijar = encabezado
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      "</sheetView></sheetViews>"
    : "";
  const datos = filas
    .map((fila, r) => {
      const celdas = fila.map((valor, c) => celda(valor, `${columna(c)}${r + 1}`, encabezado && r === 0)).join("");
      return `<row r="${r + 1}">${celdas}</row>`;
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `${fijar}<cols>${cols}</cols><sheetData>${datos}</sheetData></worksheet>`
  );
}

const ESTILOS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="5"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.0%"/>' +
  '<numFmt numFmtId="166" formatCode="+0.0%;-0.0%;0.0%"/><numFmt numFmtId="167" formatCode="d-mmm-yyyy"/>' +
  '<numFmt numFmtId="168" formatCode="0.00"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="7">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** Un nombre de hoja válido para Excel: sin []:*?/\ y de hasta 31 caracteres. */
export function nombreHoja(nombre) {
  return nombre.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Hoja";
}

/**
 * Un libro .xlsx con `hojas`: [{ nombre, filas, encabezado = true }]. Cada fila es una lista de celdas: texto, número,
 * null (vacía) o { valor, formato }, con formato "indice" (0,0), "decimal2" (0,00), "porcentaje" (0,0 %), "variacion"
 * (+0,0 %) o "fecha" (valor "aaaa-mm-dd"). Con `encabezado`, la primera fila va en negrita y queda fija al desplazarse.
 */
export function libroXlsx(hojas) {
  const nombres = [];
  for (const hoja of hojas) {
    let nombre = nombreHoja(hoja.nombre);
    for (let n = 2; nombres.includes(nombre); n++) nombre = `${nombreHoja(hoja.nombre).slice(0, 28)} ${n}`;
    nombres.push(nombre);
  }
  const xml = (texto) => codificar.encode(texto);
  const cabecera = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const tipos =
    `${cabecera}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    hojas
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
          'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      )
      .join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";
  const relacion = (id, tipo, destino) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${tipo}" Target="${destino}"/>`;
  const raiz =
    `${cabecera}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `${relacion("rId1", "officeDocument", "xl/workbook.xml")}</Relationships>`;
  const libro =
    `${cabecera}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    nombres.map((nombre, i) => `<sheet name="${escaparXml(nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    "</sheets></workbook>";
  const relacionesLibro =
    `${cabecera}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    hojas.map((_, i) => relacion(`rId${i + 1}`, "worksheet", `worksheets/sheet${i + 1}.xml`)).join("") +
    relacion(`rId${hojas.length + 1}`, "styles", "styles.xml") +
    "</Relationships>";
  return zip([
    { nombre: "[Content_Types].xml", contenido: xml(tipos) },
    { nombre: "_rels/.rels", contenido: xml(raiz) },
    { nombre: "xl/workbook.xml", contenido: xml(libro) },
    { nombre: "xl/_rels/workbook.xml.rels", contenido: xml(relacionesLibro) },
    { nombre: "xl/styles.xml", contenido: xml(ESTILOS_XML) },
    ...hojas.map((hoja, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: xml(hojaXml(hoja)) })),
  ]);
}
