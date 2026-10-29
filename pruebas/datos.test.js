// Pruebas de docs/js/datos.js: la página lee el ejemplo sintético, rechaza con un mensaje claro lo que no sabe leer y
// hace bien los cálculos de la vista por mes. Los archivos de antes, sin la venta real del horizonte, se leen como antes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  ErrorDatos,
  anioAnterior,
  cerrados,
  desglose,
  diferencia,
  elegirPronostico,
  filaPorMes,
  jerarquia,
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
  ubicar,
  urlPronostico,
} from "../docs/js/datos.js";

const EJEMPLO = new URL("../docs/datos/ejemplo/", import.meta.url);
const leer = (ruta) => JSON.parse(readFileSync(new URL(ruta, EJEMPLO), "utf8"));
const MANIFEST = leer("manifest.json");
const RESULTADOS = Object.fromEntries(MANIFEST.pronosticos.map((p) => [p.id, leer(p.ruta)]));
const RECIENTE = RESULTADOS["2026-10-12"];
const ANTERIOR = RESULTADOS["2026-09-14"];
const CAMPOS_VENTA_REAL = ["real_horizonte", "ventanas_real", "pronostico_anterior"];

/** El mismo archivo como venían antes: sin real_hasta ni la venta real del horizonte. */
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

describe("manifest.json", () => {
  test("el ejemplo se lee, del origen más reciente al más antiguo", () => {
    const entradas = revisarManifest(MANIFEST);
    assert.deepEqual(entradas.map((e) => e.id), ["2026-10-12", "2026-09-14"]);
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
    const entradas = revisarManifest(cambiado(MANIFEST, (m) => (m.pronosticos[0].version_esquema = 2)));
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
    const entradas = revisarManifest(cambiado(MANIFEST, (m) => (m.pronosticos[0].version_esquema = 2)));
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
  test("cada pronóstico del ejemplo pasa la revisión y coincide con su entrada", () => {
    for (const entrada of revisarManifest(MANIFEST)) {
      assert.equal(revisarResultados(RESULTADOS[entrada.id], entrada), RESULTADOS[entrada.id]);
    }
  });

  test("una métrica vacía es válida: el MAPE sin celdas con venta no se puede calcular", () => {
    assert.ok(RECIENTE.metricas.some((fila) => fila.mape_m2 === null));
    revisarResultados(RECIENTE);
  });

  test("una versión desconocida da un mensaje claro antes de mirar el resto", () => {
    rechaza(() => revisarResultados({ version_esquema: 2 }), "formato versión 2 y esta página solo sabe leer la versión 1");
    rechaza(() => revisarResultados({ ...RECIENTE, version_esquema: "1" }), "no dice en qué formato");
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
    test(`se rechaza: ${nombre}`, () => rechaza(() => revisarResultados(cambiado(RECIENTE, cambio)), texto));
  }

  test("se rechaza un archivo que no es el que dice el manifest", () => {
    const [reciente, anterior] = revisarManifest(MANIFEST);
    rechaza(() => revisarResultados(RESULTADOS[anterior.id], reciente), "no corresponde al pronóstico de la lista");
  });

  test("un archivo de antes, sin la venta real del horizonte, se sigue leyendo", () => {
    const viejo = sinVentaReal(RECIENTE);
    assert.equal(revisarResultados(viejo), viejo);
    assert.equal(tieneVentaReal(viejo), false);
    assert.equal(tieneVentaReal(RECIENTE), true);
  });

  const VENTA_REAL = {
    "real_hasta que no es fecha": [(r) => (r.real_hasta = "1-nov"), "real_hasta: no es una fecha"],
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
    "los campos sin real_hasta": [
      (r) => delete r.real_hasta,
      "series/0: trae real_horizonte, ventanas_real, pronostico_anterior, pero el archivo no trae real_hasta",
    ],
  };
  for (const [nombre, [cambio, texto]] of Object.entries(VENTA_REAL)) {
    test(`venta real del horizonte, se rechaza: ${nombre}`, () =>
      rechaza(() => revisarResultados(cambiado(RECIENTE, cambio)), texto));
  }

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
  const [total] = porNivel(RECIENTE.series).total;

  test("el ejemplo está a mitad del horizonte: 2 semanas con venta real en el 12-oct y 6 en el 14-sep", () => {
    assert.equal(RECIENTE.real_hasta, "2026-11-01");
    assert.equal(semanasConVentaReal(RECIENTE), 2);
    assert.equal(semanasConVentaReal(ANTERIOR), 6);
    assert.deepEqual(cerrados(RECIENTE).ventanas, [false, false, false]);
    assert.equal(semanasConVentaReal(sinVentaReal(RECIENTE)), null);
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
    const viejo = sinVentaReal(RECIENTE);
    const semanas = semanasGrafica(viejo, porNivel(viejo.series).total[0]);
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

  test("las series se agrupan por nivel", () => {
    const grupos = porNivel(RECIENTE.series);
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

describe("desglose", () => {
  const CAMPOS = ["real", "pronostico", "ventanas", ...CAMPOS_VENTA_REAL];
  const grupos = porNivel(RECIENTE.series);

  /**
   * Que las `partes` sumen `serie` valor por valor, con la tolerancia del redondeo a 1 decimal de cada una. Donde la
   * serie es null (lo que todavía no se conoce), las partes también.
   */
  function sumanLaSerie(serie, partes) {
    const tolerancia = 0.05 * (partes.length + 1) + 1e-9;
    for (const campo of CAMPOS) {
      serie[campo].forEach((valor, i) => {
        if (valor === null) {
          assert.ok(partes.every((parte) => parte[campo][i] === null), `${serie.nombre} ${campo}[${i}]: null`);
          return;
        }
        const suma = partes.reduce((total, parte) => total + parte[campo][i], 0);
        assert.ok(Math.abs(valor - suma) <= tolerancia, `${serie.nombre} ${campo}[${i}]: ${valor} contra ${suma}`);
      });
    }
  }

  test("la submarca se lee del nombre de la serie", () => {
    assert.equal(submarcaDe("Submarca B | Departamento 3 | Categoría 3.2 | Tipo 26"), "Submarca B");
    assert.equal(submarcaDe("Total"), null);
  });

  test("el total se desglosa en sus submarcas, que lo suman", () => {
    const partes = desglose(RECIENTE, grupos.total[0]);
    assert.deepEqual(partes.map((s) => s.nombre), ["Submarca A", "Submarca B", "Submarca C"]);
    sumanLaSerie(grupos.total[0], partes);
  });

  test("cada submarca se desglosa en sus series más «Otras series», que la suman", () => {
    for (const submarca of grupos.submarca) {
      const partes = desglose(RECIENTE, submarca);
      const [otras, ...resto] = partes.toReversed();
      assert.equal(otras.nivel, "otras");
      assert.equal(otras.nombre, `Otras series de ${submarca.nombre}`);
      assert.ok(resto.length > 0 && resto.every((s) => s.nombre.startsWith(`${submarca.nombre} | `)));
      assert.ok(CAMPOS.every((campo) => otras[campo].every((valor) => valor === null || valor >= 0)));
      sumanLaSerie(submarca, partes);
    }
  });

  test("con un mes cerrado, «Otras series» también trae su venta real", () => {
    const [submarca] = porNivel(ANTERIOR.series).submarca;
    const partes = desglose(ANTERIOR, submarca);
    assert.notEqual(partes.at(-1).ventanas_real[0], null);
    sumanLaSerie(submarca, partes);
    assert.notEqual(filaPorMes(ANTERIOR, partes.at(-1)).real.meses[0], null);
  });

  test("sin la venta real del horizonte, «Otras series» no la trae", () => {
    const viejo = sinVentaReal(RECIENTE);
    const otras = desglose(viejo, porNivel(viejo.series).submarca[0]).at(-1);
    assert.equal(otras.nivel, "otras");
    assert.ok(CAMPOS_VENTA_REAL.every((campo) => !(campo in otras)));
  });

  test("una serie no se desglosa", () => {
    assert.deepEqual(desglose(RECIENTE, grupos.serie[0]), []);
  });

  test("si los nombres no dicen la submarca, no hay desglose ni error", () => {
    const sinSubmarca = cambiado(RECIENTE, (r) => {
      for (const [i, serie] of r.series.entries()) if (serie.nivel === "serie") serie.nombre = `Serie ${i}`;
    });
    for (const submarca of porNivel(sinSubmarca.series).submarca) {
      assert.deepEqual(desglose(sinSubmarca, submarca), []);
    }
  });

  test("el segmentador ordena el total, cada submarca con sus series y ninguna serie suelta", () => {
    const arbol = jerarquia(RECIENTE.series);
    assert.equal(arbol.total.nombre, "Total");
    assert.deepEqual(arbol.submarcas.map((s) => s.serie.nombre), ["Submarca A", "Submarca B", "Submarca C"]);
    for (const { serie, series } of arbol.submarcas) {
      assert.ok(series.length > 0 && series.every((s) => s.nombre.startsWith(`${serie.nombre} | `)));
    }
    assert.equal(arbol.submarcas.reduce((total, s) => total + s.series.length, 0), grupos.serie.length);
    assert.deepEqual(arbol.sueltas, []);
  });

  test("el segmentador ubica el total, una submarca y una de sus series", () => {
    const arbol = jerarquia(RECIENTE.series);
    const [primera] = arbol.submarcas[1].series;
    assert.deepEqual(ubicar(arbol, "Total"), { boton: "Total", lista: [], elegida: null });
    assert.deepEqual(ubicar(arbol, "Submarca B"), { boton: "Submarca B", lista: arbol.submarcas[1].series, elegida: null });
    assert.deepEqual(ubicar(arbol, primera.nombre), {
      boton: "Submarca B",
      lista: arbol.submarcas[1].series,
      elegida: primera.nombre,
    });
  });

  test("las series sin submarca en el nombre se eligen desde el total", () => {
    const sinSubmarca = cambiado(RECIENTE, (r) => {
      for (const [i, serie] of r.series.entries()) if (serie.nivel === "serie") serie.nombre = `Serie ${i}`;
    });
    const arbol = jerarquia(sinSubmarca.series);
    assert.equal(arbol.sueltas.length, 20);
    assert.ok(arbol.submarcas.every((s) => s.series.length === 0));
    assert.deepEqual(ubicar(arbol, "Serie 4"), { boton: "Total", lista: arbol.sueltas, elegida: "Serie 4" });
  });

  test("si las series cubren toda la submarca, no aparece «Otras series»", () => {
    const serie = { nivel: "serie", nombre: "Submarca A | Tipo 1", real: [3, 4], pronostico: [5], ventanas: [6] };
    const completa = { nivel: "submarca", nombre: "Submarca A", real: [3, 4], pronostico: [5], ventanas: [6] };
    const resultados = { series: [{ nivel: "total", nombre: "Total" }, completa, serie] };
    assert.deepEqual(desglose(resultados, completa), [serie]);
  });
});
