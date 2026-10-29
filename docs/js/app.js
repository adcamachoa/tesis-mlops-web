// Arranque de la página: lee manifest.json, arma la barra (segmentador de serie, pronóstico y tema) y muestra el
// pronóstico elegido. La dirección de la página guarda el pronóstico (…/#2026-10-12), así que un enlace abre ese mismo
// pronóstico. La serie elegida filtra toda la página, salvo la tabla de modelos, que results.json solo trae para el
// backtest completo.

import { DATOS } from "../config.js";
import {
  ErrorDatos,
  desglose,
  elegirPronostico,
  filaPorMes,
  jerarquia,
  revisarManifest,
  revisarResultados,
  ubicar,
  urlPronostico,
} from "./datos.js";
import { exportarComplemento, exportarGrafica, exportarModelos, exportarPorMes } from "./exportar.js";
import { fecha, nombreSerie } from "./formato.js";
import { crearGrafica } from "./grafica.js";
import { TIPO_XLSX, libroXlsx } from "./xlsx.js";
import {
  botonExportar,
  botonesSerie,
  el,
  etiquetaPronostico,
  mensajeError,
  opcionesDetalle,
  resumen,
  resumenSerie,
  tablaDatosGrafica,
  tablaModelos,
  tablaPorMes,
} from "./secciones.js";

const $ = (id) => document.getElementById(id);
const URL_MANIFEST = new URL("manifest.json", new URL(DATOS.url, document.baseURI));
const SIN_MOVIMIENTO = window.matchMedia("(prefers-reduced-motion: reduce)");
const TEMAS = ["sistema", "claro", "oscuro"];

let entradas = [];
let pedido = 0; // si se cambia de pronóstico antes de que llegue el anterior, la respuesta vieja se descarta
let actual = null; // { resultados, arbol, serie }
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

function mostrar(resultados) {
  // al cambiar de pronóstico se conserva la serie elegida, si también está en el nuevo
  const serie = resultados.series.find((s) => s.nombre === actual?.serie) ?? resultados.series.find((s) => s.nivel === "total");
  actual = { resultados, arbol: jerarquia(resultados.series), serie: serie.nombre };
  $("resumen").replaceChildren(resumen(resultados));
  $("modelos").replaceChildren(
    ...tablaModelos(resultados.metricas, {
      alExportar: () => descargar(exportarModelos(resultados, OPCIONES_EXPORTAR)),
      alExportarComplemento: () => descargar(exportarComplemento(resultados, OPCIONES_EXPORTAR)),
    }),
  );
  $("botones-serie").replaceChildren(...botonesSerie(actual.arbol, (nombre) => elegirSerie(nombre)));
  $("pie-escala").textContent = `Escala: ${resultados.escala}.`;
  $("pie-generado").textContent = `Datos generados el ${fecha(resultados.generado)}.`;
  $("estado").hidden = true;
  $("contenido").hidden = false;
  $("selector-serie").hidden = false;
  elegirSerie(actual.serie);
}

/** El segmentador marca el botón de la serie (o de su submarca) y, si tiene series, las ofrece en la lista. */
function pintarSegmentador(nombre) {
  const { arbol } = actual;
  const { boton, lista, elegida } = ubicar(arbol, nombre);
  for (const opcion of $("botones-serie").children) {
    opcion.setAttribute("aria-pressed", String(opcion.dataset.serie === boton));
  }
  const esTotal = boton === arbol.total.nombre;
  $("selector-detalle").hidden = lista.length === 0;
  $("t-detalle").textContent = esTotal ? "Otras series" : `Serie de ${boton}`;
  $("serie-detalle").replaceChildren(...opcionesDetalle(boton, lista, esTotal).flat());
  $("serie-detalle").value = elegida ?? boton;
}

function elegirSerie(nombre, desdeLaTabla = false) {
  const { resultados } = actual;
  const serie = resultados.series.find((s) => s.nombre === nombre);
  const fila = filaPorMes(resultados, serie);
  actual.serie = nombre;
  pintarSegmentador(nombre);
  $("serie-grafica").textContent = nombreSerie(nombre);
  $("serie-meses").textContent = nombreSerie(nombre);
  $("t-resumen-serie").textContent = `${nombreSerie(nombre)} · ${resultados.semanas.pronostico.length} semanas pronosticadas`;
  $("resumen-serie").replaceChildren(resumenSerie(fila, resultados));
  grafica.mostrar(resultados, serie, $("ver-anio-anterior").checked);
  $("datos-grafica").replaceChildren(tablaDatosGrafica(resultados, serie));
  $("exportar-grafica").replaceChildren(
    botonExportar(() => descargar(exportarGrafica(resultados, serie, OPCIONES_EXPORTAR))),
  );
  const partes = desglose(resultados, serie).map((parte) => filaPorMes(resultados, parte));
  $("meses").replaceChildren(tablaPorMes(fila, partes, resultados, (otra) => elegirSerie(otra, true)));
  $("exportar-meses").replaceChildren(
    botonExportar(() => descargar(exportarPorMes(resultados, fila, partes, OPCIONES_EXPORTAR))),
  );
  if (desdeLaTabla) {
    // la serie nueva queda en la primera fila de la vista por mes, con su propio desglose debajo
    $("seccion-meses").scrollIntoView({ behavior: SIN_MOVIMIENTO.matches ? "auto" : "smooth", block: "start" });
  }
}

async function iniciar() {
  $("aviso-sinteticos").hidden = !DATOS.sinteticos;
  grafica = crearGrafica($("grafica"));
  prepararTema();
  $("serie-detalle").addEventListener("change", (evento) => elegirSerie(evento.target.value));
  $("ver-anio-anterior").addEventListener("change", () => actual && elegirSerie(actual.serie));
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
