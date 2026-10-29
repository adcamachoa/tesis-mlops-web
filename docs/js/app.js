// Arranque de la página: lee manifest.json, arma el selector de pronósticos y muestra el elegido. La dirección de la
// página guarda el pronóstico (…/#2026-10-12), así que un enlace abre ese mismo pronóstico.

import { DATOS } from "../config.js";
import { ErrorDatos, elegirPronostico, revisarManifest, revisarResultados, urlPronostico, vistaPorMes } from "./datos.js";
import { fecha } from "./formato.js";
import { crearGrafica } from "./grafica.js";
import {
  cifrasSerie,
  el,
  etiquetaPronostico,
  mensajeError,
  opcionesSeries,
  resumen,
  tablaDatosGrafica,
  tablaModelos,
  tablaPorMes,
} from "./secciones.js";

const $ = (id) => document.getElementById(id);
const URL_MANIFEST = new URL("manifest.json", new URL(DATOS.url, document.baseURI));
const SIN_MOVIMIENTO = window.matchMedia("(prefers-reduced-motion: reduce)");

let entradas = [];
let pedido = 0; // si se cambia de pronóstico antes de que llegue el anterior, la respuesta vieja se descarta
let actual = null; // { resultados, filas, serie }
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

function mostrarEstado(hijos, esError = false) {
  const estado = $("estado");
  estado.classList.toggle("error", esError);
  estado.replaceChildren(...hijos);
  estado.hidden = false;
  $("contenido").hidden = true;
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
  const serie = resultados.series.find((s) => s.nombre === actual?.serie) ?? resultados.series.find((s) => s.nivel === "total");
  actual = { resultados, filas: vistaPorMes(resultados), serie: serie.nombre };
  $("resumen").replaceChildren(resumen(resultados));
  $("modelos").replaceChildren(...tablaModelos(resultados.metricas));
  opcionesSeries($("serie"), resultados.series);
  $("pie-escala").textContent = `Escala: ${resultados.escala}.`;
  $("pie-generado").textContent = `Datos generados el ${fecha(resultados.generado)}.`;
  $("estado").hidden = true;
  $("contenido").hidden = false;
  elegirSerie(actual.serie);
}

function elegirSerie(nombre, desdeLaTabla = false) {
  const { resultados, filas } = actual;
  const fila = filas.find((f) => f.serie.nombre === nombre);
  actual.serie = nombre;
  $("serie").value = nombre;
  $("cifras-serie").replaceChildren(...cifrasSerie(fila));
  grafica.mostrar(resultados, fila.serie, $("ver-anio-anterior").checked);
  $("datos-grafica").replaceChildren(tablaDatosGrafica(resultados, fila.serie));
  $("meses").replaceChildren(tablaPorMes(filas, resultados.ventanas, nombre, (otra) => elegirSerie(otra, true)));
  if (desdeLaTabla) {
    $("seccion-grafica").scrollIntoView({ behavior: SIN_MOVIMIENTO.matches ? "auto" : "smooth", block: "start" });
  }
}

async function iniciar() {
  $("aviso-sinteticos").hidden = !DATOS.sinteticos;
  grafica = crearGrafica($("grafica"));
  $("serie").addEventListener("change", (evento) => elegirSerie(evento.target.value));
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
