// Pruebas de docs/js/exportar.js: cada tabla se exporta con las columnas de la página, los números como números y una
// hoja de notas; sin MAPE. El ejemplo es de la versión 2; el de la versión 1 está fijo en pruebas/datos/v1/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { desglose, filaPorMes, metricasDelNodo, porNivel } from "../docs/js/datos.js";
import {
  enArchivo,
  exportarComplemento,
  exportarGrafica,
  exportarModelos,
  exportarModelosNodo,
  exportarPorMes,
} from "../docs/js/exportar.js";
import { libroXlsx } from "../docs/js/xlsx.js";
import { leerZip } from "./leer-zip.js";

const leer = (carpeta, origen) =>
  JSON.parse(readFileSync(new URL(`${carpeta}/${origen}/results.json`, import.meta.url), "utf8"));
const RESULTADOS = leer("../docs/datos/ejemplo", "2026-10-12");
const ANTERIOR = leer("../docs/datos/ejemplo", "2026-09-14"); // con el mes 1 cerrado
const V1 = leer("datos/v1", "2026-10-12");
const [TOTAL] = RESULTADOS.series;
const notas = (exportado) => Object.fromEntries(exportado.hojas.find((h) => h.nombre === "Notas").filas);

/** El archivo de la versión 1 como venían antes: sin real_hasta ni la venta real del horizonte. */
function sinVentaReal(resultados) {
  const viejo = structuredClone(resultados);
  delete viejo.real_hasta;
  for (const serie of viejo.series) {
    for (const campo of ["real_horizonte", "ventanas_real", "pronostico_anterior"]) delete serie[campo];
  }
  return viejo;
}
const VIEJO = sinVentaReal(V1);

test("los nombres de archivo van sin tildes, en minúsculas y con guiones", () => {
  assert.equal(
    enArchivo("Submarca A | Departamento 1 | Categoría 1.4 | Tipo 16"),
    "submarca-a-departamento-1-categoria-1-4-tipo-16",
  );
});

test("la comparación oficial de modelos se exporta sin MAPE, con porcentajes y el sesgo con signo", () => {
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
  assert.match(notas(exportado).Tabla, /nivel tipo de producto/);
});

test("la tabla de modelos de la serie elegida se exporta con su nivel, el champion y sin MAPE ni el mejor", () => {
  const nodo = RESULTADOS.series.find((s) => s.nivel === "departamento");
  const exportado = exportarModelosNodo(RESULTADOS, nodo);
  assert.equal(exportado.archivo, `modelos_${enArchivo(nodo.nombre)}_2026-10-12.xlsx`);
  const [encabezado, ...filas] = exportado.hojas[0].filas;
  assert.deepEqual(encabezado, ["Modelo", "Champion", "WAPE mes 1", "WAPE mes 2", "WAPE total", "Sesgo total"]);
  const esperadas = metricasDelNodo(RESULTADOS, nodo);
  assert.deepEqual(filas.map((f) => f[0]), esperadas.map((f) => f.modelo));
  assert.deepEqual(filas.filter((f) => f[1] === "sí").map((f) => f[0]), [RESULTADOS.champion.modelo]);
  assert.deepEqual(filas[0][4], { valor: nodo.metricas[0].wape_total, formato: "porcentaje" });
  assert.equal(notas(exportado).Tabla, "Modelos en el backtest, medidos en la serie elegida (nivel departamento)");
  assert.equal(notas(exportado).Serie, nodo.nombre.split(" | ").join(" › "));
});

test("sin datos sintéticos, las notas no llevan el aviso", () => {
  assert.equal(notas(exportarComplemento(RESULTADOS)).Aviso, undefined);
});

test("las notas dicen hasta cuándo hay venta real, si el archivo la trae", () => {
  assert.equal(notas(exportarModelos(RESULTADOS))["Venta real hasta"], "1-nov-2026");
  assert.equal(notas(exportarModelos(VIEJO))["Venta real hasta"], undefined);
});

test("en la versión 2, las notas dicen el mínimo publicado", () => {
  assert.equal(
    notas(exportarModelos(RESULTADOS))["Mínimo publicado"],
    "0,5 de índice promedio semanal: «Otras» junta lo que no se publica por separado",
  );
  assert.equal(notas(exportarModelos(V1))["Mínimo publicado"], undefined);
});

test("los datos de la gráfica van semana por semana, con la venta real del horizonte y el pronóstico anterior", () => {
  const { archivo, hojas } = exportarGrafica(RESULTADOS, TOTAL);
  assert.equal(archivo, "grafica_total_2026-10-12.xlsx");
  const [encabezado, primera, ...resto] = hojas[0].filas;
  assert.equal(hojas[0].filas.length, 1 + 52 + 13);
  assert.equal(encabezado.at(-1), "Pronóstico anterior (índice)");
  assert.deepEqual(primera, [
    { valor: RESULTADOS.semanas.real[0], formato: "fecha" },
    "real",
    { valor: TOTAL.real[0], formato: "indice" },
    null,
    null,
    null,
  ]);
  const ultimaReal = resto[50];
  assert.deepEqual(ultimaReal[5], { valor: TOTAL.pronostico_anterior[51], formato: "indice" }); // del 14-sep
  const [primeraPronostico, segunda, tercera] = resto.slice(51);
  assert.equal(primeraPronostico[1], "pronóstico");
  assert.deepEqual(primeraPronostico[2], { valor: TOTAL.real_horizonte[0], formato: "indice" }); // ya cerró
  assert.deepEqual(primeraPronostico[3], { valor: TOTAL.pronostico[0], formato: "indice" });
  assert.deepEqual(primeraPronostico[4], { valor: TOTAL.real[0], formato: "indice" }); // 52 semanas antes
  assert.deepEqual(segunda[2], { valor: TOTAL.real_horizonte[1], formato: "indice" });
  assert.equal(tercera[2], "pendiente");
});

test("sin la venta real del horizonte, los datos de la gráfica son los de antes", () => {
  const [encabezado, primera, ...resto] = exportarGrafica(VIEJO, porNivel(VIEJO.series).total[0]).hojas[0].filas;
  assert.deepEqual(encabezado, ["Semana del", "Tipo", "Venta real (índice)", "Pronóstico (índice)", "Año anterior (índice)"]);
  assert.equal(primera.length, 5);
  assert.ok(resto.slice(51).every((renglon) => renglon[2] === null));
});

test("la vista por mes se exporta con la serie elegida, sus hijos y la venta real pendiente", () => {
  const submarca = RESULTADOS.series[1];
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
  assert.deepEqual(desglosadas.map((renglon) => renglon[0]), partes.map((p) => p.serie.nombre.split(" | ").join(" › ")));
  assert.equal(notas({ hojas })["Mínimo publicado"].slice(0, 3), "0,5");
});

test("en la versión 1, la vista por mes se exporta con «Otras series»", () => {
  const [submarca] = porNivel(V1.series).submarca;
  const partes = desglose(V1, submarca).map((parte) => filaPorMes(V1, parte));
  const desglosadas = exportarPorMes(V1, filaPorMes(V1, submarca), partes).hojas[0].filas.slice(2);
  assert.equal(desglosadas.at(-1)[0], "Otras series de Submarca A");
});

test("un mes cerrado se exporta con su venta real y la diferencia", () => {
  const [total] = ANTERIOR.series;
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
  const fila = filaPorMes(RESULTADOS, TOTAL);
  const partes = desglose(RESULTADOS, TOTAL).map((parte) => filaPorMes(RESULTADOS, parte));
  for (const exportado of [
    exportarModelos(RESULTADOS),
    exportarModelosNodo(RESULTADOS, RESULTADOS.series[1]),
    exportarComplemento(RESULTADOS),
    exportarGrafica(RESULTADOS, TOTAL),
    exportarPorMes(RESULTADOS, fila, partes),
  ]) {
    const archivos = leerZip(libroXlsx(exportado.hojas));
    assert.ok("xl/worksheets/sheet2.xml" in archivos, exportado.archivo);
  }
});
