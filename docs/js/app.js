// Arranque de la página: lee manifest.json, arma la barra (segmentador de serie, pronóstico y tema) y muestra el
// pronóstico elegido. La dirección de la página guarda el pronóstico (…/#2026-10-12), así que un enlace abre ese mismo
// pronóstico. La serie elegida (un nodo del árbol) filtra toda la página, salvo la comparación oficial de modelos, que
// es la del backtest completo. Al cambiar de pronóstico se mantiene la serie por su id o, si el nuevo no la publica por
// separado, se muestra su grupo más cercano con un aviso.

import { DATOS } from "../config.js?v=06557bc6";
import {
  ErrorDatos,
  arbol,
  conservarNodo,
  desglose,
  elegirPronostico,
  filaPorMes,
  metricasDelNodo,
  revisarManifest,
  revisarResultados,
  tienePronosticoAnterior,
  tieneVentaReal,
  urlPronostico,
} from "./datos.js?v=06557bc6";
import {
  exportarComplemento,
  exportarGrafica,
  exportarModelos,
  exportarModelosNodo,
  exportarPorMes,
} from "./exportar.js?v=06557bc6";
import { cifra, enNivel, fecha, nombreSerie } from "./formato.js?v=06557bc6";
import { crearGrafica } from "./grafica.js?v=06557bc6";
import { TIPO_XLSX, libroXlsx } from "./xlsx.js?v=06557bc6";
import {
  botonExportar,
  botonesSerie,
  el,
  etiquetaPronostico,
  listasSerie,
  mensajeError,
  resumen,
  resumenSerie,
  tablaDatosGrafica,
  tablaModelos,
  tablaModelosNodo,
  tablaPorMes,
} from "./secciones.js?v=06557bc6";

const $ = (id) => document.getElementById(id);
const URL_MANIFEST = new URL("manifest.json", new URL(DATOS.url, document.baseURI));
const SIN_MOVIMIENTO = window.matchMedia("(prefers-reduced-motion: reduce)");
const TEMAS = ["sistema", "claro", "oscuro"];

let entradas = [];
let pedido = 0; // si se cambia de pronóstico antes de que llegue el anterior, la respuesta vieja se descarta
let actual = null; // { resultados, arbol, id }: el pronóstico en pantalla, su árbol y el id del nodo elegido
let grafica = null;

async function leerJson(url, que) {
  let respuesta;
  try {
    respuesta = await fetch(url, { cache: "no-cache" });
  } catch {
    throw new ErrorDatos(`No se pudo descargar ${que}. Revisa la conexión e intenta de nuevo.`);
  }
  if (!respuesta.ok) throw new ErrorDatos(`No se pudo descargar ${que} (error ${respuesta.status}).`);
  try {
    return await respuesta.json();
  } catch {
    throw new ErrorDatos(`${que[0].toUpperCase()}${que.slice(1)} no es un JSON válido.`);
  }
}

// El tema se guarda solo en este navegador. tema.js ya lo aplicó antes de dibujar la página; aquí se arma el selector.
function temaGuardado() {
  try {
    const tema = window.localStorage.getItem("tema");
    return TEMAS.includes(tema) ? tema : "sistema";
  } catch {
    return "sistema";
  }
}

function elegirTema(tema) {
  if (tema === "sistema") delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = tema;
  try {
    if (tema === "sistema") window.localStorage.removeItem("tema");
    else window.localStorage.setItem("tema", tema);
  } catch {
    // sin almacenamiento el tema vale hasta cerrar la página
  }
  grafica.redibujar();
}

function prepararTema() {
  const elegido = temaGuardado();
  for (const opcion of document.querySelectorAll('input[name="tema"]')) {
    opcion.checked = opcion.value === elegido;
    opcion.addEventListener("change", () => opcion.checked && elegirTema(opcion.value));
  }
}

/** Arma el .xlsx de una tabla (`{ archivo, hojas }`, de exportar.js) y lo descarga. */
function descargar({ archivo, hojas }) {
  const url = URL.createObjectURL(new Blob([libroXlsx(hojas)], { type: TIPO_XLSX }));
  const enlace = el("a", { href: url, download: archivo, hidden: true });
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const OPCIONES_EXPORTAR = { sinteticos: DATOS.sinteticos };

function mostrarEstado(hijos, esError = false) {
  const estado = $("estado");
  estado.classList.toggle("error", esError);
  estado.replaceChildren(...hijos);
  estado.hidden = false;
  $("contenido").hidden = true;
  $("selector-serie").hidden = true; // sin pronóstico en pantalla no hay series que elegir
  $("aviso-nodo").hidden = true;
}

function mostrarError(error) {
  if (!(error instanceof ErrorDatos)) console.error(error);
  mostrarEstado(mensajeError(error), true);
}

function idDeLaDireccion() {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return ""; // un # mal escrito abre el más reciente
  }
}

function llenarSelectorPronosticos() {
  const select = $("pronostico");
  select.replaceChildren(
    ...entradas.map((entrada) =>
      el("option", { value: entrada.id, disabled: !entrada.soportado }, etiquetaPronostico(entrada)),
    ),
  );
  $("selector-pronostico").hidden = entradas.length < 2;
  select.addEventListener("change", () => {
    window.location.hash = select.value;
  });
}

async function abrir(id) {
  const entrada = elegirPronostico(entradas, id);
  if (!entrada) {
    mostrarError(new ErrorDatos("Ningún pronóstico de la lista viene en un formato que esta página sepa leer."));
    return;
  }
  $("pronostico").value = entrada.id;
  const numero = ++pedido;
  mostrarEstado(["Cargando el pronóstico…"]);
  try {
    const leido = await leerJson(urlPronostico(URL_MANIFEST, entrada), "el pronóstico");
    if (numero !== pedido) return;
    mostrar(revisarResultados(leido, entrada));
  } catch (error) {
    if (numero === pedido) mostrarError(error);
  }
}

/** El aviso de que la serie elegida no se publica por separado en este pronóstico y se muestra su grupo. */
function avisarNodo(anterior, mostrado, resultados) {
  $("aviso-nodo-texto").textContent =
    `${nombreSerie(anterior.nombre)} no se publica por separado en el pronóstico del ` +
    `${fecha(resultados.corrida.origen)}: se muestra ${nombreSerie(mostrado.nombre)}, ` +
    "el grupo más cercano que sí está.";
  $("aviso-nodo").hidden = false;
}

function mostrar(resultados) {
  const nuevo = arbol(resultados);
  const { id, movido } = actual ? conservarNodo(actual.arbol, actual.id, nuevo) : { id: nuevo.raiz.id, movido: false };
  if (movido) avisarNodo(actual.arbol.nodo(actual.id), nuevo.nodo(id), resultados);
  actual = { resultados, arbol: nuevo, id };
  const version = String(resultados.version_esquema);
  for (const elemento of document.querySelectorAll("[data-version]")) {
    elemento.hidden = elemento.dataset.version !== version;
  }
  $("resumen").replaceChildren(resumen(resultados));
  $("modelos").replaceChildren(
    ...tablaModelos(resultados.metricas, {
      alExportar: () => descargar(exportarModelos(resultados, OPCIONES_EXPORTAR)),
      alExportarComplemento: () => descargar(exportarComplemento(resultados, OPCIONES_EXPORTAR)),
    }),
  );
  $("botones-serie").replaceChildren(...botonesSerie(nuevo, (otro) => elegirSerie(otro)));
  // la venta real del horizonte y el pronóstico anterior solo vienen en los archivos nuevos
  for (const elemento of ["leyenda-pronostico-anterior", "nota-pronostico-anterior"]) {
    $(elemento).hidden = !tienePronosticoAnterior(resultados);
  }
  $("nota-venta-real").hidden = !tieneVentaReal(resultados);
  $("nota-real-meses").hidden = !tieneVentaReal(resultados);
  if ("indice_minimo" in resultados) $("indice-minimo").textContent = cifra(resultados.indice_minimo);
  $("pie-escala").textContent = `Escala: ${resultados.escala}.`;
  $("pie-generado").textContent = `Datos generados el ${fecha(resultados.generado)}.`;
  $("estado").hidden = true;
  $("contenido").hidden = false;
  $("selector-serie").hidden = false;
  mostrarSerie();
}

/** El segmentador marca el botón de la submarca (o el total) de la serie elegida y arma las listas de su ruta. */
function pintarSegmentador() {
  const { arbol: elArbol, id } = actual;
  const [raiz, primero = raiz] = elArbol.ruta(id);
  for (const boton of $("botones-serie").children) {
    boton.setAttribute("aria-pressed", String(boton.dataset.id === primero.id));
  }
  $("listas-serie").replaceChildren(...listasSerie(elArbol, id, (otro) => elegirSerie(otro)));
}

/** Elegir una serie desde el segmentador o desde el desglose: el aviso de un cambio de pronóstico ya no aplica. */
function elegirSerie(id, desdeLaTabla = false) {
  actual.id = id;
  $("aviso-nodo").hidden = true;
  mostrarSerie();
  if (desdeLaTabla) {
    // la serie nueva queda en la primera fila de la vista por mes, con su propio desglose debajo
    $("seccion-meses").scrollIntoView({ behavior: SIN_MOVIMIENTO.matches ? "auto" : "smooth", block: "start" });
  }
}

/** Dibuja todo lo que depende de la serie elegida. */
function mostrarSerie() {
  const { resultados, arbol: elArbol, id } = actual;
  const nodo = elArbol.nodo(id);
  const fila = filaPorMes(resultados, nodo);
  pintarSegmentador();
  $("serie-grafica").textContent = nombreSerie(nodo.nombre);
  $("serie-meses").textContent = nombreSerie(nodo.nombre);
  const semanas = resultados.semanas.pronostico.length;
  $("t-resumen-serie").textContent = `${nombreSerie(nodo.nombre)} · ${semanas} semanas pronosticadas`;
  $("resumen-serie").replaceChildren(resumenSerie(fila, resultados));
  const metricas = metricasDelNodo(resultados, nodo);
  if (metricas) {
    $("t-modelos-nodo").textContent = `En ${nombreSerie(nodo.nombre)} · ${enNivel(nodo.nivel)}`;
    $("modelos-nodo").replaceChildren(
      ...tablaModelosNodo(metricas, () => descargar(exportarModelosNodo(resultados, nodo, OPCIONES_EXPORTAR))),
    );
  }
  grafica.mostrar(resultados, nodo, {
    anioAnterior: $("ver-anio-anterior").checked,
    pronosticoAnterior: $("ver-pronostico-anterior").checked,
  });
  $("datos-grafica").replaceChildren(tablaDatosGrafica(resultados, nodo));
  $("exportar-grafica").replaceChildren(
    botonExportar(() => descargar(exportarGrafica(resultados, nodo, OPCIONES_EXPORTAR))),
  );
  const partes = desglose(resultados, nodo).map((parte) => filaPorMes(resultados, parte));
  $("meses").replaceChildren(tablaPorMes(fila, partes, resultados, (otro) => elegirSerie(otro, true)));
  $("exportar-meses").replaceChildren(
    botonExportar(() => descargar(exportarPorMes(resultados, fila, partes, OPCIONES_EXPORTAR))),
  );
}

async function iniciar() {
  $("aviso-sinteticos").hidden = !DATOS.sinteticos;
  grafica = crearGrafica($("grafica"));
  prepararTema();
  for (const casilla of ["ver-anio-anterior", "ver-pronostico-anterior"]) {
    $(casilla).addEventListener("change", () => actual && mostrarSerie());
  }
  try {
    entradas = revisarManifest(await leerJson(URL_MANIFEST, "la lista de pronósticos"));
  } catch (error) {
    mostrarError(error);
    return;
  }
  llenarSelectorPronosticos();
  window.addEventListener("hashchange", () => abrir(idDeLaDireccion()));
  await abrir(idDeLaDireccion());
}

iniciar();
