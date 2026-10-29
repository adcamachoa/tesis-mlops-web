// Pruebas de docs/js/datos.js: la página lee el ejemplo sintético (versión 2) y el de la versión 1 (fijo en
// pruebas/datos/v1/), rechaza con un mensaje claro lo que no sabe leer y hace bien los cálculos. Los archivos de antes,
// sin la venta real del horizonte, se leen como antes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  ErrorDatos,
  anioAnterior,
  arbol,
  cerrados,
  conservarNodo,
  desglose,
  diferencia,
  elegirPronostico,
  filaPorMes,
  metricasDelNodo,
  porNivel,
  revisarManifest,
  revisarResultados,
  semanaPromedio,
  semanasConVentaReal,
  semanasGrafica,
  submarcaDe,
  sumarDias,
  tienePronosticoAnterior,
  tieneVentaReal,
  urlPronostico,
} from "../docs/js/datos.js";

function leerCarpeta(carpeta) {
  const leer = (ruta) => JSON.parse(readFileSync(new URL(ruta, carpeta), "utf8"));
  const manifest = leer("manifest.json");
  return { manifest, resultados: Object.fromEntries(manifest.pronosticos.map((p) => [p.id, leer(p.ruta)])) };
}

const EJEMPLO = leerCarpeta(new URL("../docs/datos/ejemplo/", import.meta.url));
const V1 = leerCarpeta(new URL("datos/v1/", import.meta.url));
const MANIFEST = EJEMPLO.manifest;
const RECIENTE = EJEMPLO.resultados["2026-10-12"];
const ANTERIOR = EJEMPLO.resultados["2026-09-14"];
const RECIENTE_V1 = V1.resultados["2026-10-12"];
const ANTERIOR_V1 = V1.resultados["2026-09-14"];
const CAMPOS_VENTA_REAL = ["real_horizonte", "ventanas_real", "pronostico_anterior"];
const CAMPOS = ["real", "pronostico", "ventanas", ...CAMPOS_VENTA_REAL];

/** El mismo archivo de la versión 1 como venían antes: sin real_hasta ni la venta real del horizonte. */
function sinVentaReal(resultados) {
  return cambiado(resultados, (r) => {
    delete r.real_hasta;
    for (const serie of r.series) for (const campo of CAMPOS_VENTA_REAL) delete serie[campo];
  });
}

/** Que `funcion` lance ErrorDatos con `texto` en el mensaje o en alguno de los detalles. */
function rechaza(funcion, texto) {
  assert.throws(funcion, (error) => {
    assert.ok(error instanceof ErrorDatos, `se esperaba ErrorDatos y llegó ${error}`);
    const todo = [error.message, ...error.detalles].join("\n");
    assert.ok(todo.includes(texto), `no aparece "${texto}" en:\n${todo}`);
    return true;
  });
}

function cambiado(original, cambio) {
  const copia = structuredClone(original);
  cambio(copia);
  return copia;
}

/**
 * Que las `partes` sumen `nodo` valor por valor, con la tolerancia del redondeo a 1 decimal de cada una. Donde el nodo
 * es null (lo que todavía no se conoce), las partes también.
 */
function sumanElNodo(nodo, partes) {
  const tolerancia = 0.05 * (partes.length + 1) + 1e-9;
  for (const campo of CAMPOS) {
    nodo[campo].forEach((valor, i) => {
      if (valor === null) {
        assert.ok(partes.every((parte) => parte[campo][i] === null), `${nodo.nombre} ${campo}[${i}]: null`);
        return;
      }
      const suma = partes.reduce((total, parte) => total + parte[campo][i], 0);
      assert.ok(Math.abs(valor - suma) <= tolerancia, `${nodo.nombre} ${campo}[${i}]: ${valor} contra ${suma}`);
    });
  }
}

describe("manifest.json", () => {
  test("el ejemplo se lee, del origen más reciente al más antiguo", () => {
    const entradas = revisarManifest(MANIFEST);
    assert.deepEqual(entradas.map((e) => e.id), ["2026-10-12", "2026-09-14"]);
    assert.deepEqual(entradas.map((e) => e.version_esquema), [2, 2]);
    assert.ok(entradas.every((e) => e.soportado));
  });

  test("el de la versión 1 también se sabe leer", () => {
    const entradas = revisarManifest(V1.manifest);
    assert.deepEqual(entradas.map((e) => e.version_esquema), [1, 1]);
    assert.ok(entradas.every((e) => e.soportado));
  });

  test("el orden no depende de cómo venga la lista", () => {
    const alReves = cambiado(MANIFEST, (m) => m.pronosticos.reverse());
    assert.deepEqual(revisarManifest(alReves).map((e) => e.origen), ["2026-10-12", "2026-09-14"]);
  });

  test("una versión del manifest desconocida da un mensaje claro", () => {
    rechaza(() => revisarManifest({ ...MANIFEST, version_manifest: 2 }), "formato versión 2");
    rechaza(() => revisarManifest({ ...MANIFEST, version_manifest: undefined }), "no dice en qué formato");
  });

  test("una entrada con una versión de results.json desconocida queda marcada, sin romper la lista", () => {
    const entradas = revisarManifest(cambiado(MANIFEST, (m) => (m.pronosticos[0].version_esquema = 3)));
    assert.deepEqual(entradas.map((e) => e.soportado), [false, true]);
  });

  const CAMBIOS = {
    "sin pronósticos": [(m) => (m.pronosticos = []), "pronosticos: falta o está vacía"],
    "ruta que sale de la carpeta": [(m) => (m.pronosticos[0].ruta = "../otro/results.json"), "pronosticos/0/ruta"],
    "ruta absoluta": [(m) => (m.pronosticos[0].ruta = "/results.json"), "pronosticos/0/ruta"],
    "ruta a otro sitio": [(m) => (m.pronosticos[0].ruta = "https://otro.sitio/results.json"), "pronosticos/0/ruta"],
    "id con espacios": [(m) => (m.pronosticos[1].id = "otro id"), "pronosticos/1/id"],
    "fecha que no existe": [(m) => (m.pronosticos[0].origen = "2026-13-01"), "pronosticos/0/origen"],
    "dos entradas del mismo origen": [
      (m) => m.pronosticos.push({ ...m.pronosticos[0], id: "repetido" }),
      "el origen 2026-10-12 aparece dos veces",
    ],
    "id repetido": [(m) => (m.pronosticos[1].id = m.pronosticos[0].id), "el id 2026-10-12 aparece dos veces"],
  };
  for (const [nombre, [cambio, texto]] of Object.entries(CAMBIOS)) {
    test(`se rechaza: ${nombre}`, () => rechaza(() => revisarManifest(cambiado(MANIFEST, cambio)), texto));
  }

  test("se abre el pronóstico pedido si se puede leer; si no, el más reciente que sí", () => {
    const entradas = revisarManifest(cambiado(MANIFEST, (m) => (m.pronosticos[0].version_esquema = 3)));
    assert.equal(elegirPronostico(entradas, "2026-09-14").id, "2026-09-14");
    assert.equal(elegirPronostico(entradas, "2026-10-12").id, "2026-09-14"); // no se sabe leer
    assert.equal(elegirPronostico(entradas, "no-existe").id, "2026-09-14");
    assert.equal(elegirPronostico(entradas.slice(0, 1), ""), null);
  });

  test("los archivos se piden junto al manifest y nunca fuera de su carpeta", () => {
    const manifest = "https://ejemplo.github.io/tesis-mlops/datos/manifest.json";
    const url = urlPronostico(manifest, { ruta: "2026-10-12/results.json" });
    assert.equal(url.href, "https://ejemplo.github.io/tesis-mlops/datos/2026-10-12/results.json");
    rechaza(() => urlPronostico(manifest, { ruta: "../../otro/results.json" }), "sale de la carpeta");
  });
});

describe("results.json", () => {
  test("cada pronóstico del ejemplo y de la versión 1 pasa la revisión y coincide con su entrada", () => {
    for (const { manifest, resultados } of [EJEMPLO, V1]) {
      for (const entrada of revisarManifest(manifest)) {
        assert.equal(revisarResultados(resultados[entrada.id], entrada), resultados[entrada.id]);
      }
    }
  });

  test("una métrica vacía es válida: el MAPE sin celdas con venta no se puede calcular", () => {
    assert.ok(RECIENTE.metricas.some((fila) => fila.mape_m2 === null));
    revisarResultados(RECIENTE);
  });

  test("una versión desconocida da un mensaje claro antes de mirar el resto", () => {
    rechaza(() => revisarResultados({ version_esquema: 3 }), "formato versión 3 y esta página solo sabe leer la versión 1 o 2");
    rechaza(() => revisarResultados({ ...RECIENTE, version_esquema: "2" }), "no dice en qué formato");
  });

  const CAMBIOS = {
    "falta un campo": [(r) => delete r.champion, "champion: falta o no es un objeto"],
    "versión del champion como texto": [(r) => (r.champion.version = "3"), "champion/version"],
    "serie con otro largo": [(r) => r.series[1].real.pop(), "series/1/real: tiene que traer 52 números"],
    "pronóstico negativo": [(r) => (r.series[0].pronostico[0] = -1), "series/0/pronostico"],
    "venta vacía": [(r) => (r.series[2].real[3] = null), "series/2/real"],
    "ventanas de más": [(r) => r.series[0].ventanas.push(10), "series/0/ventanas: tiene que traer 3 números"],
    "nivel desconocido": [(r) => (r.series[2].nivel = "marca"), "series/2/nivel"],
    "dos totales": [(r) => r.series.push(structuredClone(r.series[0])), "una sola serie total y hay 2"],
    "sin total": [(r) => (r.series[0].nivel = "submarca"), "una sola serie total y hay 0"],
    "métrica como texto": [(r) => (r.metricas[0].wape_m1 = "0,33"), "metricas/0/wape_m1"],
    "ventana sin días": [(r) => (r.ventanas[0].dias = 0), "ventanas/0/dias"],
    "semana que no es fecha": [(r) => (r.semanas.real[0] = "12-oct"), "semanas/real/0: no es una fecha"],
  };
  for (const [nombre, [cambio, texto]] of Object.entries(CAMBIOS)) {
    test(`se rechaza: ${nombre}`, () => {
      rechaza(() => revisarResultados(cambiado(RECIENTE, cambio)), texto);
      rechaza(() => revisarResultados(cambiado(RECIENTE_V1, cambio)), texto);
    });
  }

  test("la versión 1 no admite los niveles de la 2", () => {
    rechaza(() => revisarResultados(cambiado(RECIENTE_V1, (r) => (r.series[4].nivel = "categoria"))), "series/4/nivel");
  });

  // un tipo de producto y el nodo que viene justo después en el árbol
  const hoja = RECIENTE.series.findIndex((nodo, i) => nodo.nivel === "serie" && i + 1 < RECIENTE.series.length);
  const ARBOL = {
    "sin indice_minimo": [(r) => delete r.indice_minimo, "indice_minimo: falta o no es un número mayor que 0"],
    "indice_minimo en 0": [(r) => (r.indice_minimo = 0), "indice_minimo: falta o no es un número mayor que 0"],
    "sin la venta real del horizonte": [(r) => delete r.real_hasta, "real_hasta: falta o no es una fecha"],
    "nodo sin id": [(r) => delete r.series[3].id, "series/3/id: falta o no es válido"],
    "id con mayúsculas": [(r) => (r.series[3].id = "Submarca-A"), "series/3/id: falta o no es válido"],
    "nodo sin etiqueta": [(r) => delete r.series[3].etiqueta, "series/3/etiqueta: falta o no es válido"],
    "nodo sin métricas": [(r) => delete r.series[3].metricas, "series/3/metricas: falta o está vacía"],
    "métrica de un nodo como texto": [(r) => (r.series[3].metricas[0].wape_m1 = "0,2"), "series/3/metricas/0/wape_m1"],
    "un nodo sin uno de los modelos": [
      (r) => r.series[3].metricas.pop(),
      "series/3/metricas: no trae los mismos modelos que metricas, en el mismo orden",
    ],
    "id repetido": [(r) => (r.series[2].id = r.series[1].id), `el id ${RECIENTE.series[1].id} aparece dos veces`],
    "padre que no está": [(r) => (r.series[3].padre = "no-existe"), "series/3: su padre no-existe no viene antes"],
    "hijo antes que su padre": [
      (r) => ([r.series[1], r.series[2]] = [r.series[2], r.series[1]]),
      `series/1: su padre ${RECIENTE.series[1].id} no viene antes`,
    ],
    "total con padre": [(r) => (r.series[0].padre = "submarca-a"), "series/0: solo el total va sin padre"],
    "nodo sin padre que no es el total": [(r) => (r.series[1].padre = null), "series/1: solo el total va sin padre"],
    "nivel que no sigue al del padre": [
      (r) => (r.series[2].nivel = "categoria"),
      "series/2: un nodo categoria no puede colgar de un nodo submarca",
    ],
    "nodo que cuelga de un tipo de producto": [
      (r) => (r.series[hoja + 1].padre = r.series[hoja].id),
      `series/${hoja + 1}: un nodo ${RECIENTE.series[hoja + 1].nivel} no puede colgar de un nodo serie`,
    ],
  };
  for (const [nombre, [cambio, texto]] of Object.entries(ARBOL)) {
    test(`versión 2, se rechaza: ${nombre}`, () => rechaza(() => revisarResultados(cambiado(RECIENTE, cambio)), texto));
  }

  test("se rechaza un archivo que no es el que dice el manifest", () => {
    const [reciente, anterior] = revisarManifest(MANIFEST);
    rechaza(() => revisarResultados(EJEMPLO.resultados[anterior.id], reciente), "no corresponde al pronóstico de la lista");
  });

  test("un archivo de antes, sin la venta real del horizonte, se sigue leyendo", () => {
    const viejo = sinVentaReal(RECIENTE_V1);
    assert.equal(revisarResultados(viejo), viejo);
    assert.equal(tieneVentaReal(viejo), false);
    assert.equal(tieneVentaReal(RECIENTE_V1), true);
    assert.equal(tieneVentaReal(RECIENTE), true);
  });

  const VENTA_REAL = {
    "real_hasta que no es fecha": [(r) => (r.real_hasta = "1-nov"), "real_hasta: falta o no es una fecha"],
    "real_hasta antes de datos_hasta": [(r) => (r.real_hasta = "2026-10-11"), "real_hasta: es anterior a datos_hasta"],
    "venta real en una semana que no cerró": [
      (r) => (r.series[0].real_horizonte[2] = 50),
      "series/0/real_horizonte: tiene que traer valor justo en lo que cerró",
    ],
    "sin la venta real de una semana cerrada": [
      (r) => (r.series[1].real_horizonte[0] = null),
      "series/1/real_horizonte: tiene que traer valor justo en lo que cerró",
    ],
    "un mes con venta real antes de cerrar": [
      (r) => (r.series[0].ventanas_real[0] = 80),
      "series/0/ventanas_real: tiene que traer valor justo en lo que cerró",
    ],
    "venta real negativa": [(r) => (r.series[0].real_horizonte[0] = -1), "series/0/real_horizonte: tiene que traer 13"],
    "pronóstico anterior con otro largo": [
      (r) => r.series[1].pronostico_anterior.pop(),
      "series/1/pronostico_anterior: tiene que traer 52 valores",
    ],
    "una serie sin sus campos": [(r) => delete r.series[3].ventanas_real, "series/3/ventanas_real: tiene que traer 3"],
  };
  for (const [nombre, [cambio, texto]] of Object.entries(VENTA_REAL)) {
    test(`venta real del horizonte, se rechaza: ${nombre}`, () => {
      rechaza(() => revisarResultados(cambiado(RECIENTE, cambio)), texto);
      rechaza(() => revisarResultados(cambiado(RECIENTE_V1, cambio)), texto);
    });
  }

  test("en la versión 1, los campos de la venta real sin real_hasta se rechazan", () => {
    rechaza(
      () => revisarResultados(cambiado(RECIENTE_V1, (r) => delete r.real_hasta)),
      "series/0: trae real_horizonte, ventanas_real, pronostico_anterior, pero el archivo no trae real_hasta",
    );
  });

  test("un mes cerrado lleva su venta real: en el del 14-sep cerró el mes 1", () => {
    assert.deepEqual(cerrados(ANTERIOR).ventanas, [true, false, false]);
    assert.ok(ANTERIOR.series.every((s) => s.ventanas_real[0] !== null));
    rechaza(
      () => revisarResultados(cambiado(ANTERIOR, (r) => (r.series[2].ventanas_real[0] = null))),
      "series/2/ventanas_real: tiene que traer valor justo",
    );
  });
});

describe("venta real del horizonte", () => {
  const [total] = RECIENTE.series;

  test("el ejemplo está a mitad del horizonte: 2 semanas con venta real en el 12-oct y 6 en el 14-sep", () => {
    assert.equal(RECIENTE.real_hasta, "2026-11-01");
    assert.equal(semanasConVentaReal(RECIENTE), 2);
    assert.equal(semanasConVentaReal(ANTERIOR), 6);
    assert.deepEqual(cerrados(RECIENTE).ventanas, [false, false, false]);
    assert.equal(semanasConVentaReal(sinVentaReal(RECIENTE_V1)), null);
  });

  test("la gráfica sigue con la venta real después del origen y deja pendiente el resto", () => {
    const semanas = semanasGrafica(RECIENTE, total);
    assert.equal(semanas.length, 52 + 13);
    const horizonte = semanas.slice(52);
    assert.deepEqual(horizonte.map((s) => s.real), total.real_horizonte);
    assert.deepEqual(horizonte.map((s) => s.pendiente), total.real_horizonte.map((v) => v === null));
    assert.deepEqual(horizonte.map((s) => s.anioAnterior), anioAnterior(RECIENTE, total));
    assert.ok(semanas.slice(0, 52).every((s) => !s.pendiente && s.pronostico === null));
  });

  test("el pronóstico anterior va solo en las semanas reales que cubría un origen previo", () => {
    const anteriores = semanasGrafica(RECIENTE, total).map((s) => s.pronosticoAnterior);
    assert.deepEqual(anteriores.slice(0, 52), total.pronostico_anterior);
    assert.equal(anteriores.slice(0, 52).filter((v) => v !== null).length, 4); // del 21-sep al 12-oct
    assert.ok(anteriores.slice(52).every((v) => v === null));
    assert.equal(tienePronosticoAnterior(RECIENTE), true);
    assert.equal(tienePronosticoAnterior(ANTERIOR), false); // no hubo un origen antes del 14-sep
  });

  test("sin la venta real del horizonte, la gráfica es la de antes", () => {
    const viejo = sinVentaReal(RECIENTE_V1);
    const semanas = semanasGrafica(viejo, viejo.series[0]);
    assert.ok(semanas.slice(52).every((s) => s.real === null && !s.pendiente));
    assert.ok(semanas.every((s) => s.pronosticoAnterior === null));
    assert.equal(tienePronosticoAnterior(viejo), false);
  });

  test("la diferencia es la del sesgo: positiva si se pronosticó de más", () => {
    assert.ok(Math.abs(diferencia(110, 100) - 0.1) < 1e-12);
    assert.ok(Math.abs(diferencia(90, 100) + 0.1) < 1e-12);
    assert.equal(diferencia(5, 0), null);
    assert.equal(diferencia(5, null), null);
  });
});

describe("cálculos", () => {
  test("sumar días no se corre con el huso horario ni con el cambio de año", () => {
    assert.equal(sumarDias("2026-10-12", 7), "2026-10-19");
    assert.equal(sumarDias("2026-12-28", 7), "2027-01-04");
    assert.equal(sumarDias("2027-10-18", -364), "2026-10-19");
  });

  test("las mismas semanas del año anterior son las 13 semanas reales más antiguas", () => {
    for (const serie of RECIENTE.series) {
      assert.deepEqual(anioAnterior(RECIENTE, serie), serie.real.slice(0, 13));
    }
  });

  test("las series de la versión 1 se agrupan por nivel", () => {
    const grupos = porNivel(RECIENTE_V1.series);
    assert.deepEqual(
      Object.fromEntries(Object.entries(grupos).map(([nivel, series]) => [nivel, series.length])),
      { total: 1, submarca: 3, serie: 20 },
    );
  });

  // un pronóstico chico, hecho a mano: 2 semanas reales del año anterior y 2 de pronóstico
  const CHICO = {
    semanas: { real: ["2025-10-20", "2025-10-27"], pronostico: ["2026-10-19", "2026-10-26"] },
    ventanas: [{ dias: 7 }, { dias: 10 }],
    series: [{ nivel: "total", nombre: "Total", real: [100, 80], pronostico: [99, 72], ventanas: [99, 100] }],
  };

  test("cada mes se lleva a semana promedio: el periodo entre sus días, por 7", () => {
    assert.equal(semanaPromedio(310, 31), 70);
    assert.deepEqual(filaPorMes(CHICO, CHICO.series[0]).meses, [99, 70]);
  });

  test("el trimestre se compara con las mismas semanas del año anterior", () => {
    const fila = filaPorMes(CHICO, CHICO.series[0]);
    assert.equal(fila.trimestre, 85.5);
    assert.equal(fila.anioAnterior, 90);
    assert.equal(fila.variacion, 85.5 / 90 - 1);
  });

  test("si falta una semana del año anterior, el trimestre no se compara", () => {
    const corto = cambiado(CHICO, (r) => {
      r.semanas.real = ["2025-10-27"];
      r.series[0].real = [80];
    });
    const fila = filaPorMes(corto, corto.series[0]);
    assert.equal(fila.anioAnterior, null);
    assert.equal(fila.variacion, null);
  });

  test("sin la venta real del horizonte, la fila por mes no la trae", () => {
    assert.equal(filaPorMes(CHICO, CHICO.series[0]).real, null);
  });

  test("con la venta real, cada mes cerrado la trae como semana promedio, con su diferencia; el resto, null", () => {
    const conReal = cambiado(CHICO, (r) => {
      r.real_hasta = "2026-10-25";
      r.series[0].ventanas_real = [110, null];
    });
    const { real } = filaPorMes(conReal, conReal.series[0]);
    assert.deepEqual(real.meses, [110, null]);
    assert.deepEqual(real.diferencias, [99 / 110 - 1, null]);
    assert.equal(real.trimestre, null); // hasta que cierran todos los meses
    assert.equal(real.diferenciaTrimestre, null);
  });

  test("cuando cierran todos los meses, el trimestre también trae su venta real", () => {
    const conReal = cambiado(CHICO, (r) => {
      r.real_hasta = "2026-11-08";
      r.series[0].ventanas_real = [110, 80];
    });
    const { real } = filaPorMes(conReal, conReal.series[0]);
    assert.deepEqual(real.meses, [110, 56]);
    assert.equal(real.trimestre, (190 * 7) / 17);
    assert.equal(real.diferenciaTrimestre, 199 / 190 - 1);
  });

  test("en el ejemplo, el trimestre por semana cuadra con la suma de los tres meses", () => {
    for (const serie of RECIENTE.series) {
      const fila = filaPorMes(RECIENTE, serie);
      const porMeses = (serie.ventanas.reduce((a, b) => a + b, 0) * 7) / 91;
      assert.ok(Math.abs(fila.trimestre - porMeses) < 0.1, `${serie.nombre}: ${fila.trimestre} contra ${porMeses}`);
    }
  });
});

describe("árbol de la versión 2", () => {
  const ARBOL = arbol(RECIENTE);
  const ARBOL_ANTERIOR = arbol(ANTERIOR);
  const padres = new Set(RECIENTE.series.map((nodo) => nodo.padre));

  test("la raíz es el total y cada nodo cuelga de su padre, por id", () => {
    assert.equal(ARBOL.raiz, RECIENTE.series[0]);
    assert.deepEqual(ARBOL.hijos("total").map((nodo) => nodo.id), ["submarca-a", "submarca-b", "submarca-c"]);
    const tipo = RECIENTE.series.find((nodo) => nodo.nivel === "serie");
    const ruta = ARBOL.ruta(tipo.id);
    assert.deepEqual(ruta.map((nodo) => nodo.nivel), ["total", "submarca", "departamento", "categoria", "serie"]);
    ruta.slice(1).forEach((nodo, i) => assert.equal(nodo.padre, ruta[i].id));
    assert.equal(ARBOL.nodo("no-existe"), null);
  });

  test("el desglose de un nodo son sus hijos del archivo, con «Otras» al final, y suman el nodo", () => {
    for (const resultados of [RECIENTE, ANTERIOR]) {
      for (const nodo of resultados.series) {
        const partes = desglose(resultados, nodo);
        assert.deepEqual(partes, resultados.series.filter((otro) => otro.padre === nodo.id));
        assert.ok(partes.every((parte) => resultados.series.includes(parte)), "solo nodos publicados");
        const otras = partes.findIndex((parte) => parte.nivel === "otras");
        assert.ok(otras === -1 || otras === partes.length - 1, `${nodo.nombre}: «Otras» va al final`);
        if (partes.length) sumanElNodo(nodo, partes);
      }
    }
  });

  test("hay un padre con «Otras», que se puede elegir como cualquier nodo", () => {
    const otras = RECIENTE.series.find((nodo) => nodo.nivel === "otras");
    assert.ok(otras, "el ejemplo trae «Otras»");
    assert.equal(desglose(RECIENTE, ARBOL.nodo(otras.padre)).at(-1), otras);
    assert.equal(ARBOL.nodo(otras.id), otras);
    assert.deepEqual(desglose(RECIENTE, otras), []);
  });

  test("un nodo que podría desglosarse y no trae hijos no se desglosa", () => {
    const sinHijos = RECIENTE.series.find((nodo) => nodo.nivel === "categoria" && !padres.has(nodo.id));
    assert.ok(sinHijos, "el ejemplo trae una categoría sin hijos");
    assert.deepEqual(desglose(RECIENTE, sinHijos), []);
  });

  test("al cambiar de origen, el nodo se mantiene por su id", () => {
    const enLosDos = RECIENTE.series.findLast((nodo) => ARBOL_ANTERIOR.nodo(nodo.id));
    assert.deepEqual(conservarNodo(ARBOL, enLosDos.id, ARBOL_ANTERIOR), { id: enLosDos.id, movido: false });
  });

  test("si el otro origen no lo publica por separado, se sube a su ancestro más cercano y se avisa", () => {
    const soloAqui = RECIENTE.series.find((nodo) => !ARBOL_ANTERIOR.nodo(nodo.id));
    assert.ok(soloAqui, "el ejemplo trae un nodo que está en el 12-oct y no en el 14-sep");
    const cercano = ARBOL.ruta(soloAqui.id).findLast((nodo) => ARBOL_ANTERIOR.nodo(nodo.id));
    assert.notEqual(cercano.id, "total");
    assert.deepEqual(conservarNodo(ARBOL, soloAqui.id, ARBOL_ANTERIOR), { id: cercano.id, movido: true });
  });

  test("desde la raíz se llega a la raíz sin aviso, también entre versiones", () => {
    assert.deepEqual(conservarNodo(ARBOL, "total", ARBOL_ANTERIOR), { id: "total", movido: false });
    assert.deepEqual(conservarNodo(arbol(RECIENTE_V1), "Total", ARBOL), { id: "total", movido: false });
  });

  test("la tabla de modelos de un nodo marca el champion por el nombre de la raíz", () => {
    const nodo = RECIENTE.series[2];
    const filas = metricasDelNodo(RECIENTE, nodo);
    assert.deepEqual(filas.map((f) => f.modelo), RECIENTE.metricas.map((f) => f.modelo));
    assert.deepEqual(filas.filter((f) => f.es_champion).map((f) => f.modelo), [RECIENTE.champion.modelo]);
    assert.equal(filas[0].wape_total, nodo.metricas[0].wape_total);
    assert.ok(filas.every((f) => !("es_mejor" in f)), "el mejor solo se marca en la comparación oficial");
  });
});

describe("versión 1", () => {
  const ARBOL = arbol(RECIENTE_V1);
  const grupos = porNivel(RECIENTE_V1.series);

  /** La misma versión 1 con nombres de serie que no dicen la submarca. */
  const sinSubmarca = cambiado(RECIENTE_V1, (r) => {
    for (const [i, serie] of r.series.entries()) if (serie.nivel === "serie") serie.nombre = `Serie ${i}`;
  });

  test("la submarca se lee del nombre de la serie", () => {
    assert.equal(submarcaDe("Submarca B | Departamento 3 | Categoría 3.2 | Tipo 26"), "Submarca B");
    assert.equal(submarcaDe("Total"), null);
  });

  test("el árbol cuelga cada serie de su submarca, con el nombre como id y sin repetir la submarca", () => {
    assert.equal(ARBOL.raiz.nombre, "Total");
    assert.deepEqual(ARBOL.hijos("Total").map((s) => s.nombre), ["Submarca A", "Submarca B", "Submarca C"]);
    for (const submarca of grupos.submarca) {
      const series = ARBOL.hijos(submarca.nombre);
      assert.ok(series.length > 0);
      for (const serie of series) {
        assert.equal(serie.id, serie.nombre);
        assert.equal(`${submarca.nombre} | ${serie.etiqueta}`, serie.nombre);
      }
    }
    const total = grupos.submarca.reduce((suma, s) => suma + ARBOL.hijos(s.nombre).length, 0);
    assert.equal(total, grupos.serie.length);
  });

  test("la ruta de una serie es el total, su submarca y ella", () => {
    const [serie] = ARBOL.hijos("Submarca B");
    assert.deepEqual(ARBOL.ruta(serie.id).map((s) => s.nombre), ["Total", "Submarca B", serie.nombre]);
  });

  test("las series sin submarca en el nombre cuelgan del total", () => {
    const sueltas = arbol(sinSubmarca);
    assert.equal(sueltas.hijos("Total").length, 3 + 20);
    assert.ok(grupos.submarca.every((s) => sueltas.hijos(s.nombre).length === 0));
    assert.deepEqual(sueltas.ruta("Serie 4").map((s) => s.nombre), ["Total", "Serie 4"]);
  });

  test("no trae métricas por nodo: solo la comparación oficial", () => {
    assert.equal(metricasDelNodo(RECIENTE_V1, ARBOL.nodo("Submarca A")), null);
  });

  test("el total se desglosa en sus submarcas, que lo suman", () => {
    const partes = desglose(RECIENTE_V1, grupos.total[0]);
    assert.deepEqual(partes.map((s) => s.nombre), ["Submarca A", "Submarca B", "Submarca C"]);
    sumanElNodo(grupos.total[0], partes);
  });

  test("cada submarca se desglosa en sus series más «Otras series», que la suman", () => {
    for (const submarca of grupos.submarca) {
      const partes = desglose(RECIENTE_V1, submarca);
      const [otras, ...resto] = partes.toReversed();
      assert.equal(otras.nivel, "otras");
      assert.equal(otras.id, null); // no está en el archivo: no se puede elegir
      assert.equal(otras.nombre, `Otras series de ${submarca.nombre}`);
      assert.ok(resto.length > 0 && resto.every((s) => s.nombre.startsWith(`${submarca.nombre} | `)));
      assert.ok(CAMPOS.every((campo) => otras[campo].every((valor) => valor === null || valor >= 0)));
      sumanElNodo(submarca, partes);
    }
  });

  test("con un mes cerrado, «Otras series» también trae su venta real", () => {
    const [submarca] = porNivel(ANTERIOR_V1.series).submarca;
    const partes = desglose(ANTERIOR_V1, submarca);
    assert.notEqual(partes.at(-1).ventanas_real[0], null);
    sumanElNodo(submarca, partes);
    assert.notEqual(filaPorMes(ANTERIOR_V1, partes.at(-1)).real.meses[0], null);
  });

  test("sin la venta real del horizonte, «Otras series» no la trae", () => {
    const viejo = sinVentaReal(RECIENTE_V1);
    const otras = desglose(viejo, porNivel(viejo.series).submarca[0]).at(-1);
    assert.equal(otras.nivel, "otras");
    assert.ok(CAMPOS_VENTA_REAL.every((campo) => !(campo in otras)));
  });

  test("una serie no se desglosa", () => {
    assert.deepEqual(desglose(RECIENTE_V1, grupos.serie[0]), []);
  });

  test("si los nombres no dicen la submarca, no hay desglose ni error", () => {
    for (const submarca of porNivel(sinSubmarca.series).submarca) {
      assert.deepEqual(desglose(sinSubmarca, submarca), []);
    }
  });

  test("si las series cubren toda la submarca, no aparece «Otras series»", () => {
    const serie = { nivel: "serie", nombre: "Submarca A | Tipo 1", real: [3, 4], pronostico: [5], ventanas: [6] };
    const completa = { nivel: "submarca", nombre: "Submarca A", real: [3, 4], pronostico: [5], ventanas: [6] };
    const resultados = { version_esquema: 1, series: [{ nivel: "total", nombre: "Total" }, completa, serie] };
    assert.deepEqual(desglose(resultados, completa).map((s) => s.nombre), [serie.nombre]);
  });
});
