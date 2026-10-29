// Pruebas de docs/js/formato.js: números y fechas como en PLAN.md de tesis-mlops.
import assert from "node:assert/strict";
import { test } from "node:test";

import { VACIO, fecha, fechaCorta, indice, nombreSerie, porcentaje, variacion } from "../docs/js/formato.js";

const NBSP = " "; // el espacio antes de % no se parte en dos líneas

test("el índice va con coma decimal", () => {
  assert.equal(indice(98.44), "98,4");
  assert.equal(indice(100), "100,0");
  assert.equal(indice(2.3259, 2), "2,33");
});

test("las métricas van como porcentaje; el sesgo y las variaciones con signo", () => {
  assert.equal(porcentaje(0.342), `34,2${NBSP}%`);
  assert.equal(variacion(0.042), `+4,2${NBSP}%`);
  assert.equal(variacion(-0.096), `−9,6${NBSP}%`);
  assert.equal(variacion(0), `0,0${NBSP}%`);
});

test("un valor vacío se muestra como guion", () => {
  for (const formato of [indice, porcentaje, variacion]) assert.equal(formato(null), VACIO);
});

test("las fechas van como 28-oct-2026, sin cero adelante", () => {
  assert.equal(fecha("2026-10-28T16:28:09"), "28-oct-2026");
  assert.equal(fecha("2026-11-09"), "9-nov-2026");
  assert.equal(fechaCorta("2027-01-04"), "4-ene");
});

test("los niveles del nombre de una serie se separan con ›", () => {
  assert.equal(nombreSerie("Submarca A | Departamento 1 | Tipo 3"), "Submarca A › Departamento 1 › Tipo 3");
  assert.equal(nombreSerie("Total"), "Total");
});
