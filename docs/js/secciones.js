// Arma el resumen, las tablas y los mensajes de la página. Todo el texto que viene de los datos entra como texto
// (append de strings), nunca como HTML.

import { ErrorDatos, METRICAS_ESTANDAR, anioAnterior, porNivel } from "./datos.js";
import { fecha, fechaCorta, indice, nombreSerie, porcentaje, variacion } from "./formato.js";

const MAXIMO_DETALLES = 8;
const GRUPOS = { total: "Total", submarca: "Submarcas", serie: "Series principales" };
const CIEN = "100 = semana promedio del total";

/** Un elemento con sus atributos (`clase` es className) y sus hijos; null y false se saltan. */
export function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor === null || valor === false) continue;
    if (nombre === "clase") nodo.className = valor;
    else nodo.setAttribute(nombre, valor === true ? "" : valor);
  }
  nodo.append(...hijos.flat().filter((hijo) => hijo !== null && hijo !== false && hijo !== undefined));
  return nodo;
}

export function etiquetaPronostico(entrada) {
  const texto = `Origen ${fecha(entrada.origen)} · hecho el ${fecha(entrada.fecha_prediccion)}`;
  return entrada.soportado ? texto : `${texto} (formato v${entrada.version_esquema}, no soportado)`;
}

export function resumen({ champion, corrida, backtest, semanas, ventanas }) {
  const datos = [
    ["Modelo champion", [el("code", {}, champion.modelo)], `versión ${champion.version}`],
    ["Fecha del pronóstico", [fecha(corrida.fecha_prediccion)], `entrenado el ${fecha(corrida.fecha_entrenamiento)}`],
    ["Datos hasta", [fecha(corrida.datos_hasta)], `origen: semana del ${fecha(corrida.origen)}`],
    [
      "Periodo pronosticado",
      [`${fecha(semanas.pronostico[0])} al ${fecha(ventanas.at(-1).hasta)}`],
      `${semanas.pronostico.length} semanas`,
    ],
    [
      "Backtest",
      [`${backtest.origenes} orígenes`],
      `del ${fecha(backtest.primer_origen)} al ${fecha(backtest.ultimo_origen)}`,
    ],
  ];
  return el(
    "dl",
    { clase: "resumen" },
    datos.map(([titulo, valor, detalle]) =>
      el("div", { clase: "dato" }, el("dt", {}, titulo), el("dd", {}, valor, el("span", { clase: "detalle" }, detalle))),
    ),
  );
}

function celdaMetrica(valor, formato, atributos = {}) {
  return el("td", { ...atributos, title: valor === null ? "No se puede calcular" : null }, formato(valor));
}

function nombreModelo(fila) {
  return [
    el("code", {}, fila.modelo),
    fila.es_champion && el("span", { clase: "etiqueta etiqueta-champion" }, "champion"),
    fila.es_mejor && el("span", { clase: "etiqueta" }, "mejor"),
  ];
}

/** La tabla de modelos en el formato estándar, y el complemento en un desplegable. */
export function tablaModelos(metricas) {
  const grupo = (texto, columnas) => el("th", { scope: "colgroup", colspan: columnas, clase: "separador" }, texto);
  const columna = (texto, separador = false) => el("th", { scope: "col", clase: separador ? "separador" : null }, texto);
  const estandar = el(
    "table",
    {},
    el(
      "thead",
      {},
      el(
        "tr",
        {},
        el("th", { scope: "col", rowspan: 2 }, "Modelo"),
        grupo("WAPE", 3),
        grupo("MAPE (referencia)", 3),
        grupo("Sesgo", 1),
      ),
      el(
        "tr",
        {},
        ["WAPE", "MAPE"].flatMap(() => [columna("Mes 1", true), columna("Mes 2"), columna("Total")]),
        columna("Total", true),
      ),
    ),
    el(
      "tbody",
      {},
      metricas.map((fila) =>
        el(
          "tr",
          { clase: fila.es_champion ? "fila-champion" : null },
          el("th", { scope: "row" }, nombreModelo(fila)),
          METRICAS_ESTANDAR.map((metrica, i) =>
            celdaMetrica(fila[metrica], metrica === "sesgo_total" ? variacion : porcentaje, {
              clase: i % 3 === 0 ? "separador" : null,
            }),
          ),
        ),
      ),
    ),
  );

  const champion = metricas.find((fila) => fila.es_champion);
  const nota =
    champion && !champion.es_mejor
      ? el(
          "p",
          { clase: "nota" },
          "El mejor del backtest no siempre es el champion: el champion solo se reemplaza cuando un retador le gana con " +
            "claridad en el backtest.",
        )
      : null;

  const complemento = el(
    "details",
    {},
    el("summary", {}, "Métricas complementarias"),
    el(
      "p",
      { clase: "nota" },
      "El WAPE tipo × mes junta las tres ventanas por serie y es el criterio para elegir el mejor modelo. El MAE y el " +
        "RMSE van en la escala del índice.",
    ),
    el(
      "div",
      { clase: "desplazable" },
      el(
        "table",
        {},
        el(
          "thead",
          {},
          el("tr", {}, ["Modelo", "WAPE tipo × mes", "MAE", "RMSE"].map((texto) => el("th", { scope: "col" }, texto))),
        ),
        el(
          "tbody",
          {},
          metricas.map((fila) =>
            el(
              "tr",
              {},
              el("th", { scope: "row" }, el("code", {}, fila.modelo)),
              celdaMetrica(fila.wape_tipo_mes, porcentaje),
              celdaMetrica(fila.mae, (v) => indice(v, 2)),
              celdaMetrica(fila.rmse, (v) => indice(v, 2)),
            ),
          ),
        ),
      ),
    ),
  );
  return [el("div", { clase: "desplazable" }, estandar), nota, complemento].filter(Boolean);
}

/** Llena el selector de series, agrupado por nivel. */
export function opcionesSeries(select, series) {
  const grupos = porNivel(series);
  select.replaceChildren(
    ...Object.entries(GRUPOS)
      .filter(([nivel]) => grupos[nivel].length)
      .map(([nivel, titulo]) =>
        el("optgroup", { label: titulo }, grupos[nivel].map((s) => el("option", { value: s.nombre }, nombreSerie(s.nombre)))),
      ),
  );
}

/** La línea de cifras de la serie elegida, sobre la gráfica. */
export function cifrasSerie(fila) {
  const partes = [
    "Semana promedio del pronóstico: ",
    el("strong", {}, indice(fila.trimestre)),
  ];
  if (fila.anioAnterior !== null) {
    partes.push(" · mismas semanas del año anterior: ", el("strong", {}, indice(fila.anioAnterior)), ` (${variacion(fila.variacion)})`);
  }
  return partes;
}

/** La tabla con los datos de la gráfica, semana por semana. */
export function tablaDatosGrafica(resultados, serie) {
  const { real, pronostico } = resultados.semanas;
  const previo = anioAnterior(resultados, serie);
  const filas = [
    ...real.map((semana, i) => [semana, serie.real[i], null, null]),
    ...pronostico.map((semana, i) => [semana, null, serie.pronostico[i], previo[i]]),
  ];
  const columnas = ["Semana del", "Venta real (índice)", "Pronóstico (índice)", "Año anterior (índice)"];
  return el(
    "table",
    {},
    el("caption", { clase: "nota" }, `${nombreSerie(serie.nombre)}: venta semanal en índice (${CIEN})`),
    el("thead", {}, el("tr", {}, columnas.map((texto) => el("th", { scope: "col" }, texto)))),
    el(
      "tbody",
      {},
      filas.map(([semana, ...valores]) =>
        el("tr", {}, el("th", { scope: "row", clase: "numero" }, fecha(semana)), valores.map((v) => el("td", {}, indice(v)))),
      ),
    ),
  );
}

function encabezado(titulo, ...subtitulos) {
  return [titulo, ...subtitulos.map((texto) => el("span", { clase: "subtitulo-columna" }, texto))];
}

function filaMeses(fila, nombre, atributos = {}) {
  return el(
    "tr",
    atributos,
    el("th", { scope: "row", clase: "nombre-serie" }, nombre),
    fila.meses.map((valor) => el("td", {}, indice(valor))),
    el("td", { clase: "separador" }, indice(fila.trimestre)),
    el("td", { title: fila.variacion === null ? "Faltan semanas del año anterior" : null }, variacion(fila.variacion)),
  );
}

/**
 * La vista por mes de la serie elegida (`fila`) y, debajo, su desglose (`partes`). Elegir una fila del desglose llama
 * a `alElegir` con su nombre; la fila de "Otras series" no se puede elegir, porque no está en el archivo.
 */
export function tablaPorMes(fila, partes, resultados, alElegir) {
  const { ventanas, semanas } = resultados;
  const columnas = ventanas.length + 3;
  const unidad = "semana promedio, índice";
  const meses = ventanas.map((ventana, i) => {
    const periodo = `${fechaCorta(ventana.desde)} al ${fechaCorta(ventana.hasta)} · ${ventana.dias} días`;
    return el("th", { scope: "col" }, encabezado(`Mes ${i + 1}`, unidad, periodo));
  });
  const trimestre = encabezado("Trimestre", unidad, `${semanas.pronostico.length} semanas`);
  const titulos = el(
    "tr",
    {},
    el("th", { scope: "col" }, "Serie"),
    meses,
    el("th", { scope: "col", clase: "separador" }, trimestre),
    el("th", { scope: "col" }, encabezado("Contra año anterior", "variación del trimestre, %")),
  );
  // dentro del desglose de una submarca, sus series se nombran sin repetirla
  const prefijo = fila.serie.nivel === "submarca" ? `${fila.serie.nombre} | ` : null;
  const nombreCorto = (nombre) => nombreSerie(prefijo && nombre.startsWith(prefijo) ? nombre.slice(prefijo.length) : nombre);
  const desglosadas = partes.map((parte) => {
    if (parte.serie.nivel === "otras") {
      const aclaracion = "La submarca menos las series de la lista: results.json solo trae las series de más venta.";
      const nombre = el("span", { title: aclaracion }, nombreSerie(parte.serie.nombre));
      return filaMeses(parte, nombre, { clase: "fila-otras" });
    }
    const boton = el("button", { type: "button", clase: "boton-serie" }, nombreCorto(parte.serie.nombre));
    boton.addEventListener("click", () => alElegir(parte.serie.nombre));
    return filaMeses(parte, boton);
  });
  const tituloDesglose = fila.serie.nivel === "total" ? "Desglose por submarca" : `Desglose de ${fila.serie.nombre} por serie`;
  return el(
    "table",
    {},
    el("thead", {}, titulos),
    el(
      "tbody",
      {},
      filaMeses(fila, nombreSerie(fila.serie.nombre), { "aria-current": "true" }),
      desglosadas.length > 0 && el("tr", { clase: "grupo" }, el("th", { scope: "colgroup", colspan: columnas }, tituloDesglose)),
      desglosadas,
    ),
  );
}

/** El mensaje de error para el lector, con el detalle de lo que falló si lo hay. */
export function mensajeError(error) {
  const conocido = error instanceof ErrorDatos;
  const detalles = conocido ? error.detalles : [];
  const resto = detalles.length - MAXIMO_DETALLES;
  return [
    el("h2", {}, "No se puede mostrar el pronóstico"),
    el("p", {}, conocido ? error.message : "Ocurrió un error inesperado. Intenta de nuevo más tarde."),
    detalles.length > 0 &&
      el(
        "ul",
        {},
        detalles.slice(0, MAXIMO_DETALLES).map((detalle) => el("li", {}, detalle)),
        resto > 0 && el("li", {}, `y ${resto} más`),
      ),
  ].filter(Boolean);
}
