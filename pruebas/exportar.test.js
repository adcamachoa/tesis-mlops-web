// Pruebas de docs/js/exportar.js: cada tabla se exporta con las columnas de la página, los números como números y una
// hoja de notas; sin MAPE.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { desglose, filaPorMes, porNivel } from "../docs/js/datos.js";
import { enArchivo, exportarComplemento, exportarGrafica, exportarModelos, exportarPorMes } from "../docs/js/exportar.js";
import { libroXlsx } from "../docs/js/xlsx.js";
import { leerZip } from "./leer-zip.js";

const RESULTADOS = JSON.parse(
  readFileSync(new URL("../docs/datos/ejemplo/2026-10-12/results.json", import.meta.url), "utf8"),
);
const grupos = porNivel(RESULTADOS.series);
const notas = (exportado) => Object.fromEntries(exportado.hojas.find((h) => h.nombre === "Notas").filas);

test("los nombres de archivo van sin tildes, en minúsculas y con guiones", () => {
  assert.equal(
    enArchivo("Submarca A | Departamento 1 | Categoría 1.4 | Tipo 16"),
    "submarca-a-departamento-1-categoria-1-4-tipo-16",
  );
});

test("la tabla de modelos se exporta sin MAPE, con porcentajes y el sesgo con signo", () => {
  const exportado = exportarModelos(RESULTADOS, { sinteticos: true });
  assert.equal(exportado.archivo, "modelos-backtest_2026-10-12.xlsx");
  const [encabezado, primera] = exportado.hojas[0].filas;
  assert.deepEqual(encabezado, ["Modelo", "Champion", "Mejor", "WAPE mes 1", "WAPE mes 2", "WAPE total", "Sesgo total"]);
  assert.ok(!encabezado.some((titulo) => titulo.includes("MAPE")));
  const fila = RESULTADOS.metricas[0];
  assert.deepEqual(primera, [
    fila.modelo,
    fila.es_champion ? "sí" : "",
    fila.es_mejor ? "sí" : "",
    { valor: fila.wape_m1, formato: "porcentaje" },
    { valor: fila.wape_m2, formato: "porcentaje" },
    { valor: fila.wape_total, formato: "porcentaje" },
    { valor: fila.sesgo_total, formato: "variacion" },
  ]);
  assert.equal(exportado.hojas[0].filas.length, RESULTADOS.metricas.length + 1);
  assert.match(notas(exportado).Aviso, /sintéticos/);
});

test("sin datos sintéticos, las notas no llevan el aviso", () => {
  assert.equal(notas(exportarComplemento(RESULTADOS)).Aviso, undefined);
});

test("los datos de la gráfica van semana por semana, con el año anterior en las semanas de pronóstico", () => {
  const [total] = grupos.total;
  const { archivo, hojas } = exportarGrafica(RESULTADOS, total);
  assert.equal(archivo, "grafica_total_2026-10-12.xlsx");
  const [, primera, ...resto] = hojas[0].filas;
  assert.equal(hojas[0].filas.length, 1 + 52 + 13);
  assert.deepEqual(primera, [
    { valor: RESULTADOS.semanas.real[0], formato: "fecha" },
    "real",
    { valor: total.real[0], formato: "indice" },
    null,
    null,
  ]);
  const primeraPronostico = resto[51];
  assert.equal(primeraPronostico[1], "pronóstico");
  assert.deepEqual(primeraPronostico[3], { valor: total.pronostico[0], formato: "indice" });
  assert.deepEqual(primeraPronostico[4], { valor: total.real[0], formato: "indice" }); // 52 semanas antes
});

test("la vista por mes se exporta con la serie elegida y su desglose", () => {
  const [submarca] = grupos.submarca;
  const fila = filaPorMes(RESULTADOS, submarca);
  const partes = desglose(RESULTADOS, submarca).map((parte) => filaPorMes(RESULTADOS, parte));
  const { archivo, hojas } = exportarPorMes(RESULTADOS, fila, partes);
  assert.equal(archivo, "pronostico-por-mes_submarca-a_2026-10-12.xlsx");
  const [encabezado, elegida, ...desglosadas] = hojas[0].filas;
  assert.match(encabezado[2], /^Mes 1: 19-oct-2026 al 18-nov-2026 \(semana promedio, índice\)$/);
  assert.match(encabezado.at(-1), /variación del trimestre, %/);
  assert.deepEqual(elegida.slice(0, 2), ["Submarca A", "elegida"]);
  assert.deepEqual(elegida[2], { valor: Number(fila.meses[0].toFixed(2)), formato: "indice" });
  assert.equal(desglosadas.length, partes.length);
  assert.ok(desglosadas.every((renglon) => renglon[1] === "desglose"));
  assert.equal(desglosadas.at(-1)[0], "Otras series de Submarca A");
});

test("cada exportación arma un .xlsx que se puede leer", () => {
  const [total] = grupos.total;
  const fila = filaPorMes(RESULTADOS, total);
  const partes = desglose(RESULTADOS, total).map((parte) => filaPorMes(RESULTADOS, parte));
  for (const exportado of [
    exportarModelos(RESULTADOS),
    exportarComplemento(RESULTADOS),
    exportarGrafica(RESULTADOS, total),
    exportarPorMes(RESULTADOS, fila, partes),
  ]) {
    const archivos = leerZip(libroXlsx(exportado.hojas));
    assert.ok("xl/worksheets/sheet2.xml" in archivos, exportado.archivo);
  }
});
