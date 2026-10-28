// Arma el resumen, las tablas y los mensajes de la página. Todo el texto que viene de los datos entra como texto
// (append de strings), nunca como HTML.

import { ErrorDatos, METRICAS_ESTANDAR, anioAnterior, porNivel } from "./datos.js";
import { fecha, fechaCorta, indice, nombreSerie, porcentaje, variacion } from "./formato.js";

const MAXIMO_DETALLES = 8;
const GRUPOS = { total: "Total", submarca: "Submarcas", serie: "Series principales" };

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
  return el(
    "table",
    {},
    el("caption", { clase: "nota" }, `${nombreSerie(serie.nombre)}, en índice`),
    el(
      "thead",
      {},
      el("tr", {}, ["Semana del", "Venta real", "Pronóstico", "Año anterior"].map((texto) => el("th", { scope: "col" }, texto))),
    ),
    el(
      "tbody",
      {},
      filas.map(([semana, ...valores]) =>
        el("tr", {}, el("th", { scope: "row", clase: "numero" }, fecha(semana)), valores.map((v) => el("td", {}, indice(v)))),
      ),
    ),
  );
}

/** La vista por mes: una fila por serie, agrupadas por nivel. Elegir una fila llama a `alElegir` con su nombre. */
export function tablaPorMes(filas, ventanas, elegida, alElegir) {
  const columnas = ventanas.length + 3;
  const encabezado = el(
    "tr",
    {},
    el("th", { scope: "col" }, "Serie"),
    ventanas.map(columnaMes),
    el("th", { scope: "col", clase: "separador" }, "Trimestre", el("span", { clase: "subtitulo-columna" }, "13 semanas")),
    el("th", { scope: "col" }, "Contra año anterior", el("span", { clase: "subtitulo-columna" }, "trimestre")),
  );
  const cuerpo = Object.entries(GRUPOS).flatMap(([nivel, titulo]) => {
    const delNivel = filas.filter((fila) => fila.serie.nivel === nivel);
    if (!delNivel.length) return [];
    return [
      el("tr", { clase: "grupo" }, el("th", { scope: "colgroup", colspan: columnas }, titulo)),
      ...delNivel.map((fila) => {
        const nombre = fila.serie.nombre;
        const boton = el("button", { type: "button", clase: "boton-serie" }, nombreSerie(nombre));
        boton.addEventListener("click", () => alElegir(nombre));
        return el(
          "tr",
          { "aria-current": nombre === elegida ? "true" : null },
          el("th", { scope: "row", clase: "nombre-serie" }, boton),
          fila.meses.map((valor) => el("td", {}, indice(valor))),
          el("td", { clase: "separador" }, indice(fila.trimestre)),
          el("td", { title: fila.variacion === null ? "Faltan semanas del año anterior" : null }, variacion(fila.variacion)),
        );
      }),
    ];
  });
  return el("table", {}, el("thead", {}, encabezado), el("tbody", {}, cuerpo));
}

function columnaMes(ventana, i) {
  const periodo = `${fechaCorta(ventana.desde)} al ${fechaCorta(ventana.hasta)} · ${ventana.dias} días`;
  return el("th", { scope: "col" }, `Mes ${i + 1}`, el("span", { clase: "subtitulo-columna" }, periodo));
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
