// Arma el resumen, las tablas y los mensajes de la página. Todo el texto que viene de los datos entra como texto
// (append de strings), nunca como HTML.

import { ErrorDatos, semanasConVentaReal, semanasGrafica, tieneVentaReal } from "./datos.js?v=06557bc6";
import { fecha, fechaCorta, indice, nombreNivel, nombreSerie, porcentaje, variacion } from "./formato.js?v=06557bc6";

const MAXIMO_DETALLES = 8;
const COLUMNAS_MODELOS = ["wape_m1", "wape_m2", "wape_total", "sesgo_total"]; // sin MAPE
const CIEN = "100 = semana promedio del total";
// la primera opción de cada lista del segmentador: el nodo entero
const TODO = { submarca: "Toda la submarca", departamento: "Todo el departamento", categoria: "Toda la categoría" };
// el título de cada lista del segmentador, por el nivel de las opciones
const LISTA = { submarca: "Submarca", departamento: "Departamento", categoria: "Categoría", serie: "Tipo de producto" };

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

/** "2 de 13 semanas pronosticadas": cuántas ya tienen venta real. */
function semanasConReal(cerradas, total) {
  return cerradas === 0 ? "todavía ninguna semana pronosticada" : `${cerradas} de ${total} semanas pronosticadas`;
}

export function resumen(resultados) {
  const { champion, corrida, backtest, semanas, ventanas } = resultados;
  const cerradas = semanasConVentaReal(resultados);
  const datos = [
    ["Modelo champion", [el("code", {}, champion.modelo)], `versión ${champion.version}`],
    ["Fecha del pronóstico", [fecha(corrida.fecha_prediccion)], `entrenado el ${fecha(corrida.fecha_entrenamiento)}`],
    ["Datos hasta", [fecha(corrida.datos_hasta)], `origen: semana del ${fecha(corrida.origen)}`],
    cerradas !== null && [
      "Venta real hasta",
      [fecha(resultados.real_hasta)],
      semanasConReal(cerradas, semanas.pronostico.length),
    ],
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
  ].filter(Boolean);
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

/** Una fila con el botón que exporta la tabla de arriba a Excel. */
export function botonExportar(alExportar) {
  const boton = el("button", { type: "button", clase: "boton-exportar" }, "Exportar a Excel (.xlsx)");
  boton.addEventListener("click", alExportar);
  return el("div", { clase: "exportar" }, boton);
}

/** WAPE de mes 1, mes 2 y total, y sesgo total, de cada modelo. El MAPE viene en results.json, pero no se muestra. */
function tablaEstandar(metricas) {
  const grupo = (texto, columnas) => el("th", { scope: "colgroup", colspan: columnas, clase: "separador" }, texto);
  const columna = (texto, separador = false) => el("th", { scope: "col", clase: separador ? "separador" : null }, texto);
  return el(
    "table",
    {},
    el(
      "thead",
      {},
      el("tr", {}, el("th", { scope: "col", rowspan: 2 }, "Modelo"), grupo("WAPE", 3), grupo("Sesgo", 1)),
      el("tr", {}, columna("Mes 1", true), columna("Mes 2"), columna("Total"), columna("Total", true)),
    ),
    el(
      "tbody",
      {},
      metricas.map((fila) =>
        el(
          "tr",
          { clase: fila.es_champion ? "fila-champion" : null },
          el("th", { scope: "row" }, nombreModelo(fila)),
          COLUMNAS_MODELOS.map((metrica, i) =>
            celdaMetrica(fila[metrica], metrica === "sesgo_total" ? variacion : porcentaje, {
              clase: i === 0 || metrica === "sesgo_total" ? "separador" : null,
            }),
          ),
        ),
      ),
    ),
  );
}

/**
 * La tabla de modelos de la raíz, la comparación oficial (con el mejor y el champion), y el complemento en un
 * desplegable, cada una con su botón para exportar a Excel.
 */
export function tablaModelos(metricas, { alExportar, alExportarComplemento }) {
  const estandar = tablaEstandar(metricas);
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
    botonExportar(alExportarComplemento),
  );
  return [el("div", { clase: "desplazable" }, estandar), botonExportar(alExportar), nota, complemento].filter(Boolean);
}

/** La tabla de modelos medida en el nodo elegido (de metricasDelNodo), con su botón para exportar a Excel. */
export function tablaModelosNodo(metricas, alExportar) {
  return [el("div", { clase: "desplazable" }, tablaEstandar(metricas)), botonExportar(alExportar)];
}

/** Los botones del segmentador: el total y sus hijos (las submarcas). Cada uno lleva el id de su nodo en data-id. */
export function botonesSerie(arbol, alElegir) {
  return [arbol.raiz, ...arbol.hijos(arbol.raiz.id)].map((nodo) => {
    const atributos = { type: "button", clase: "boton-segmento", "data-id": nodo.id };
    const boton = el("button", atributos, nombreSerie(nodo.etiqueta));
    boton.addEventListener("click", () => alElegir(nodo.id));
    return boton;
  });
}

/**
 * Las listas del segmentador, debajo de los botones: una por cada nodo de la ruta del nodo `id` que tiene hijos, desde
 * la submarca, con el nodo entero primero y sus hijos debajo. Elegir una opción llama a `alElegir` con su id. En la
 * versión 1 hay una sola, con las series de la submarca.
 */
export function listasSerie(arbol, id, alElegir) {
  const ruta = arbol.ruta(id);
  return ruta.slice(1).flatMap((nodo, i) => {
    const hijos = arbol.hijos(nodo.id);
    if (!hijos.length) return [];
    const select = el(
      "select",
      { id: `lista-serie-${i + 1}` },
      el("option", { value: nodo.id }, TODO[nodo.nivel] ?? `Todo ${nombreSerie(nodo.etiqueta)}`),
      hijos.map((hijo) => el("option", { value: hijo.id }, nombreSerie(hijo.etiqueta))),
    );
    select.value = ruta[i + 2]?.id ?? nodo.id;
    select.addEventListener("change", () => alElegir(select.value));
    const nivel = hijos.find((hijo) => hijo.nivel !== "otras")?.nivel;
    const titulo = arbol.version === 1 ? `Serie de ${nodo.nombre}` : (LISTA[nivel] ?? "Grupo");
    return [el("div", { clase: "selector" }, el("label", { for: select.id }, titulo), select)];
  });
}

/** Las tarjetas del resumen con las cifras de la serie elegida en el trimestre pronosticado. */
export function resumenSerie(fila, { semanas, ventanas }) {
  const datos = [
    ["Semana promedio del pronóstico", indice(fila.trimestre), `${fecha(semanas.pronostico[0])} al ${fecha(ventanas.at(-1).hasta)}`],
    ["Mismas semanas del año anterior", indice(fila.anioAnterior), "venta real, 52 semanas antes"],
    ["Contra el año anterior", variacion(fila.variacion), "variación del trimestre"],
  ];
  return el(
    "dl",
    { clase: "resumen resumen-serie" },
    datos.map(([titulo, valor, detalle]) =>
      el("div", { clase: "dato" }, el("dt", {}, titulo), el("dd", {}, valor, el("span", { clase: "detalle" }, detalle))),
    ),
  );
}

/**
 * La tabla con los datos de la gráfica, semana por semana. Si el archivo trae la venta real del horizonte, suma el
 * pronóstico anterior y dice "pendiente" en las semanas pronosticadas que todavía no cierran.
 */
export function tablaDatosGrafica(resultados, serie) {
  const conVentaReal = tieneVentaReal(resultados);
  const columnas = [
    "Semana del",
    "Venta real (índice)",
    "Pronóstico (índice)",
    "Año anterior (índice)",
    conVentaReal && "Pronóstico anterior (índice)",
  ].filter(Boolean);
  const filas = semanasGrafica(resultados, serie).map((s) => [
    s.semana,
    s.pendiente ? "pendiente" : indice(s.real),
    indice(s.pronostico),
    indice(s.anioAnterior),
    conVentaReal && indice(s.pronosticoAnterior),
  ]);
  return el(
    "table",
    {},
    el("caption", { clase: "nota" }, `${nombreSerie(serie.nombre)}: venta semanal en índice (${CIEN})`),
    el("thead", {}, el("tr", {}, columnas.map((texto) => el("th", { scope: "col" }, texto)))),
    el(
      "tbody",
      {},
      filas.map(([semana, ...valores]) =>
        el(
          "tr",
          {},
          el("th", { scope: "row", clase: "numero" }, fecha(semana)),
          valores.filter((v) => v !== false).map((v) => el("td", {}, v)),
        ),
      ),
    ),
  );
}

function encabezado(titulo, ...subtitulos) {
  return [titulo, ...subtitulos.map((texto) => el("span", { clase: "subtitulo-columna" }, texto))];
}

const DIFERENCIA = "Diferencia: (pronóstico − real) / real, positiva si se pronosticó de más";

/**
 * Debajo del pronóstico de un periodo, su venta real y la diferencia, o "pendiente" si el periodo no ha cerrado. Nada
 * si el archivo no trae la venta real del horizonte.
 */
function realDelPeriodo(real, diferenciaReal) {
  if (real === undefined) return null;
  if (real === null) return el("span", { clase: "real-periodo pendiente" }, "pendiente");
  return el(
    "span",
    { clase: "real-periodo" },
    `real ${indice(real)} · `,
    el("span", { title: DIFERENCIA }, variacion(diferenciaReal)),
  );
}

function filaMeses(fila, nombre, atributos = {}) {
  const { real } = fila;
  return el(
    "tr",
    atributos,
    el("th", { scope: "row", clase: "nombre-serie" }, nombre),
    fila.meses.map((valor, i) => el("td", {}, indice(valor), realDelPeriodo(real?.meses[i], real?.diferencias[i]))),
    el("td", { clase: "separador" }, indice(fila.trimestre), realDelPeriodo(real?.trimestre, real?.diferenciaTrimestre)),
    el("td", { title: fila.variacion === null ? "Faltan semanas del año anterior" : null }, variacion(fila.variacion)),
  );
}

/** El título de la fila que separa el desglose: "Desglose por submarca", "Desglose de Submarca A por departamento". */
function tituloDesglose(nodo, partes, version) {
  if (nodo.nivel === "total") return "Desglose por submarca";
  const nivel = partes.find((parte) => parte.serie.nivel !== "otras")?.serie.nivel;
  const por = version === 1 ? "serie" : nombreNivel(nivel);
  return `Desglose de ${nombreSerie(nodo.nombre)}${nivel ? ` por ${por}` : ""}`;
}

/** El nombre de una fila del desglose: un botón que elige ese nodo, o solo el texto si no está en el archivo. */
function nombreParte(parte, padre, alElegir) {
  const { serie } = parte;
  if (serie.id === null) {
    // "Otras series" de la versión 1, calculada aquí
    const aclaracion = "La submarca menos las series de la lista: results.json solo trae las series de más venta.";
    return el("span", { title: aclaracion }, nombreSerie(serie.nombre));
  }
  const aclaracion =
    serie.nivel === "otras"
      ? `Junta lo de ${nombreSerie(padre.nombre)} que no se publica por separado.`
      : null;
  const boton = el("button", { type: "button", clase: "boton-serie", title: aclaracion }, nombreSerie(serie.etiqueta));
  boton.addEventListener("click", () => alElegir(serie.id));
  return boton;
}

/**
 * La vista por mes de la serie elegida (`fila`) y, debajo, su desglose (`partes`). Elegir una fila del desglose llama
 * a `alElegir` con su id; la fila de "Otras series" de la versión 1 no se puede elegir, porque no está en el archivo.
 * En la versión 2, un nodo que podría desglosarse y no trae hijos lo dice en una línea.
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
  // dentro del desglose de un nodo, sus partes van con su etiqueta, sin repetir el nombre del nodo
  const desglosadas = partes.map((parte) => {
    const atributos = { clase: parte.serie.nivel === "otras" ? "fila-otras" : null };
    return filaMeses(parte, nombreParte(parte, fila.serie, alElegir), atributos);
  });
  const { nivel } = fila.serie;
  const version = resultados.version_esquema;
  const sinDesglose = version !== 1 && partes.length === 0 && nivel !== "serie";
  const motivo =
    nivel === "otras"
      ? "«Otras» no se desglosa: junta grupos que no se publican por separado."
      : "No se desglosa: sus partes no se publican por separado en este pronóstico.";
  return el(
    "table",
    {},
    el("thead", {}, titulos),
    el(
      "tbody",
      {},
      filaMeses(fila, nombreSerie(fila.serie.nombre), { "aria-current": "true" }),
      desglosadas.length > 0 &&
        el(
          "tr",
          { clase: "grupo" },
          el("th", { scope: "colgroup", colspan: columnas }, tituloDesglose(fila.serie, partes, version)),
        ),
      desglosadas,
      sinDesglose && el("tr", { clase: "sin-desglose" }, el("td", { colspan: columnas }, motivo)),
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
