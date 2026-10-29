// Pruebas de docs/js/exportar.js: cada tabla se exporta con las columnas de la página, los números como números y una
// hoja de notas; sin MAPE.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { desglose, filaPorMes, porNivel } from "../docs/js/datos.js";
import { enArchivo, exportarComplemento, exportarGrafica, exportarModelos, exportarPorMes } from "../docs/js/exportar.js";
import { libroXlsx } from "../docs/js/xlsx.js";
import { leerZip } from "./leer-zip.js";

const leer = (origen) =>
  JSON.parse(readFileSync(new URL(`../docs/datos/ejemplo/${origen}/results.json`, import.meta.url), "utf8"));
const RESULTADOS = leer("2026-10-12");
const ANTERIOR = leer("2026-09-14"); // con el mes 1 cerrado
const grupos = porNivel(RESULTADOS.series);
const notas = (exportado) => Object.fromEntries(exportado.hojas.find((h) => h.nombre === "Notas").filas);

/** El mismo archivo como venían antes: sin real_hasta ni la venta real del horizonte. */
function sinVentaReal(resultados) {
  const viejo = structuredClone(resultados);
  delete viejo.real_hasta;
  for (const serie of viejo.series) {
    for (const campo of ["real_horizonte", "ventanas_real", "pronostico_anterior"]) delete serie[campo];
  }
  return viejo;
}
const VIEJO = sinVentaReal(RESULTADOS);

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

test("las notas dicen hasta cuándo hay venta real, si el archivo la trae", () => {
  assert.equal(notas(exportarModelos(RESULTADOS))["Venta real hasta"], "1-nov-2026");
  assert.equal(notas(exportarModelos(VIEJO))["Venta real hasta"], undefined);
});

test("los datos de la gráfica van semana por semana, con la venta real del horizonte y el pronóstico anterior", () => {
  const [total] = grupos.total;
  const { archivo, hojas } = exportarGrafica(RESULTADOS, total);
  assert.equal(archivo, "grafica_total_2026-10-12.xlsx");
  const [encabezado, primera, ...resto] = hojas[0].filas;
  assert.equal(hojas[0].filas.length, 1 + 52 + 13);
  assert.equal(encabezado.at(-1), "Pronóstico anterior (índice)");
  assert.deepEqual(primera, [
    { valor: RESULTADOS.semanas.real[0], formato: "fecha" },
    "real",
    { valor: total.real[0], formato: "indice" },
    null,
    null,
    null,
  ]);
  const ultimaReal = resto[50];
  assert.deepEqual(ultimaReal[5], { valor: total.pronostico_anterior[51], formato: "indice" }); // del 14-sep
  const [primeraPronostico, segunda, tercera] = resto.slice(51);
  assert.equal(primeraPronostico[1], "pronóstico");
  assert.deepEqual(primeraPronostico[2], { valor: total.real_horizonte[0], formato: "indice" }); // ya cerró
  assert.deepEqual(primeraPronostico[3], { valor: total.pronostico[0], formato: "indice" });
  assert.deepEqual(primeraPronostico[4], { valor: total.real[0], formato: "indice" }); // 52 semanas antes
  assert.deepEqual(segunda[2], { valor: total.real_horizonte[1], formato: "indice" });
  assert.equal(tercera[2], "pendiente");
});

test("sin la venta real del horizonte, los datos de la gráfica son los de antes", () => {
  const [encabezado, primera, ...resto] = exportarGrafica(VIEJO, porNivel(VIEJO.series).total[0]).hojas[0].filas;
  assert.deepEqual(encabezado, ["Semana del", "Tipo", "Venta real (índice)", "Pronóstico (índice)", "Año anterior (índice)"]);
  assert.equal(primera.length, 5);
  assert.ok(resto.slice(51).every((renglon) => renglon[2] === null));
});

test("la vista por mes se exporta con la serie elegida, su desglose y la venta real pendiente", () => {
  const [submarca] = grupos.submarca;
  const fila = filaPorMes(RESULTADOS, submarca);
  const partes = desglose(RESULTADOS, submarca).map((parte) => filaPorMes(RESULTADOS, parte));
  const { archivo, hojas } = exportarPorMes(RESULTADOS, fila, partes);
  assert.equal(archivo, "pronostico-por-mes_submarca-a_2026-10-12.xlsx");
  const [encabezado, elegida, ...desglosadas] = hojas[0].filas;
  assert.deepEqual(encabezado.slice(2, 5), [
    "Mes 1: 19-oct-2026 al 18-nov-2026, pronóstico (semana promedio, índice)",
    "Mes 1: 19-oct-2026 al 18-nov-2026, venta real (semana promedio, índice)",
    "Mes 1: 19-oct-2026 al 18-nov-2026, diferencia ((pronóstico − real) / real)",
  ]);
  assert.equal(encabezado.length, 2 + 4 * 3 + 1);
  assert.match(encabezado.at(-1), /variación del trimestre, %/);
  assert.deepEqual(elegida.slice(0, 2), ["Submarca A", "elegida"]);
  assert.deepEqual(elegida[2], { valor: Number(fila.meses[0].toFixed(2)), formato: "indice" });
  assert.deepEqual(elegida.slice(3, 5), ["pendiente", "pendiente"]); // ningún mes cerró todavía
  assert.equal(desglosadas.length, partes.length);
  assert.ok(desglosadas.every((renglon) => renglon[1] === "desglose"));
  assert.equal(desglosadas.at(-1)[0], "Otras series de Submarca A");
});

test("un mes cerrado se exporta con su venta real y la diferencia", () => {
  const [total] = porNivel(ANTERIOR.series).total;
  const fila = filaPorMes(ANTERIOR, total);
  const [, elegida] = exportarPorMes(ANTERIOR, fila, []).hojas[0].filas;
  assert.deepEqual(elegida[3], { valor: Number(fila.real.meses[0].toFixed(2)), formato: "indice" });
  assert.deepEqual(elegida[4], { valor: Number(fila.real.diferencias[0].toFixed(4)), formato: "variacion" });
  assert.deepEqual(elegida.slice(6, 8), ["pendiente", "pendiente"]); // el mes 2
});

test("sin la venta real del horizonte, la vista por mes se exporta como antes", () => {
  const [submarca] = porNivel(VIEJO.series).submarca;
  const fila = filaPorMes(VIEJO, submarca);
  const [encabezado] = exportarPorMes(VIEJO, fila, []).hojas[0].filas;
  assert.match(encabezado[2], /^Mes 1: 19-oct-2026 al 18-nov-2026 \(semana promedio, índice\)$/);
  assert.equal(encabezado.length, 2 + 4 + 1);
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
