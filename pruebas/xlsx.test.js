// Pruebas de docs/js/xlsx.js: el ZIP se puede leer y sus CRC cuadran, y el libro trae las partes y los formatos que
// Excel necesita.
import assert from "node:assert/strict";
import { test } from "node:test";

import { columna, crc32, diaExcel, escaparXml, libroXlsx, nombreHoja, zip } from "../docs/js/xlsx.js";
import { leerZip } from "./leer-zip.js";

const texto = new TextEncoder();

test("el CRC-32 es el de ZIP", () => {
  assert.equal(crc32(texto.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("el ZIP guarda cada archivo tal cual y se puede volver a leer", () => {
  const bytes = zip([
    { nombre: "a.txt", contenido: texto.encode("hola") },
    { nombre: "carpeta/año.xml", contenido: texto.encode("<x>ñ</x>") },
  ]);
  assert.deepEqual(leerZip(bytes), { "a.txt": "hola", "carpeta/año.xml": "<x>ñ</x>" });
});

test("las columnas van como en Excel", () => {
  assert.deepEqual([0, 25, 26, 701, 702].map(columna), ["A", "Z", "AA", "ZZ", "AAA"]);
});

test("las fechas van como número de día de Excel", () => {
  assert.equal(diaExcel("2026-10-12"), 46307);
  assert.equal(diaExcel("1900-03-01"), 61);
});

test("el texto se escapa para XML y sin caracteres de control", () => {
  assert.equal(escaparXml('a & b < c > "d"\u0001'), "a &amp; b &lt; c &gt; &quot;d&quot;");
});

test("los nombres de hoja no llevan caracteres prohibidos ni pasan de 31", () => {
  const nombre = nombreHoja("Pronóstico [Total]: 2026/10 con un nombre largo");
  assert.ok(nombre.length <= 31);
  assert.doesNotMatch(nombre, /[[\]:*?/\\]/);
  assert.equal(nombreHoja("***"), "Hoja");
});

test("el libro trae las partes de Excel, el encabezado en negrita y los números con su formato", () => {
  const archivos = leerZip(
    libroXlsx([
      {
        nombre: "Datos",
        filas: [
          ["Semana", "Índice", "Variación", "Nota"],
          [
            { valor: "2026-10-12", formato: "fecha" },
            { valor: 98.4, formato: "indice" },
            { valor: -0.105, formato: "variacion" },
            "a < b",
            { valor: 2.3259, formato: "decimal2" },
          ],
          [null, { valor: null, formato: "indice" }, 3, undefined],
        ],
      },
      { nombre: "Notas", encabezado: false, filas: [["Escala", "índice"]] },
      { nombre: "Notas", filas: [["otra"]] },
    ]),
  );
  assert.deepEqual(Object.keys(archivos).sort(), [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
    "xl/worksheets/sheet3.xml",
  ]);
  const hoja = archivos["xl/worksheets/sheet1.xml"];
  assert.match(hoja, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Semana<\/t>/);
  assert.match(hoja, /<c r="A2" s="5"><v>46307<\/v><\/c>/);
  assert.match(hoja, /<c r="B2" s="2"><v>98.4<\/v><\/c>/);
  assert.match(hoja, /<c r="C2" s="4"><v>-0.105<\/v><\/c>/);
  assert.match(hoja, /a &lt; b/);
  assert.match(hoja, /<c r="E2" s="6"><v>2.3259<\/v><\/c>/);
  assert.match(hoja, /<row r="3"><c r="C3" s="0"><v>3<\/v><\/c><\/row>/); // las celdas vacías no se escriben
  assert.match(hoja, /state="frozen"/);
  assert.doesNotMatch(archivos["xl/worksheets/sheet2.xml"], /frozen|s="1"/); // sin encabezado
  assert.match(archivos["xl/workbook.xml"], /name="Notas" sheetId="2".*name="Notas 2" sheetId="3"/);
  assert.match(archivos["[Content_Types].xml"], /\/xl\/worksheets\/sheet3\.xml/);
});
