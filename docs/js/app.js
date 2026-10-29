// Arranque de la página: lee manifest.json, arma los selectores y muestra el pronóstico elegido. La dirección de la
// página guarda el pronóstico (…/#2026-10-12), así que un enlace abre ese mismo pronóstico. La serie elegida manda en
// toda la página, salvo en la tabla de modelos, que results.json solo trae para el backtest completo.

import { DATOS } from "../config.js";
import {
  ErrorDatos,
  desglose,
  elegirPronostico,
  filaPorMes,
  revisarManifest,
  revisarResultados,
  urlPronostico,
} from "./datos.js";
import { fecha, nombreSerie } from "./formato.js";
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
let actual = null; // { resultados, serie }
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

/** La barra de selectores se oculta si no hay nada que elegir. */
function actualizarBarra() {
  $("barra").hidden = $("selector-pronostico").hidden && $("selector-serie").hidden;
}

function mostrarEstado(hijos, esError = false) {
  const estado = $("estado");
  estado.classList.toggle("error", esError);
  estado.replaceChildren(...hijos);
  estado.hidden = false;
  $("contenido").hidden = true;
  $("selector-serie").hidden = true; // sin pronóstico en pantalla no hay series que elegir
  actualizarBarra();
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
  actualizarBarra();
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
  actual = { resultados, serie: serie.nombre };
  $("resumen").replaceChildren(resumen(resultados));
  $("modelos").replaceChildren(...tablaModelos(resultados.metricas));
  opcionesSeries($("serie"), resultados.series);
  $("pie-escala").textContent = `Escala: ${resultados.escala}.`;
  $("pie-generado").textContent = `Datos generados el ${fecha(resultados.generado)}.`;
  $("estado").hidden = true;
  $("contenido").hidden = false;
  $("selector-serie").hidden = false;
  actualizarBarra();
  elegirSerie(actual.serie);
}

function elegirSerie(nombre, desdeLaTabla = false) {
  const { resultados } = actual;
  const serie = resultados.series.find((s) => s.nombre === nombre);
  const fila = filaPorMes(resultados, serie);
  actual.serie = nombre;
  $("serie").value = nombre;
  $("serie-grafica").textContent = nombreSerie(nombre);
  $("serie-meses").textContent = nombreSerie(nombre);
  $("cifras-serie").replaceChildren(...cifrasSerie(fila));
  grafica.mostrar(resultados, serie, $("ver-anio-anterior").checked);
  $("datos-grafica").replaceChildren(tablaDatosGrafica(resultados, serie));
  const partes = desglose(resultados, serie).map((parte) => filaPorMes(resultados, parte));
  $("meses").replaceChildren(tablaPorMes(fila, partes, resultados, (otra) => elegirSerie(otra, true)));
  if (desdeLaTabla) {
    // la serie nueva queda en la primera fila de la vista por mes, con su propio desglose debajo
    $("seccion-meses").scrollIntoView({ behavior: SIN_MOVIMIENTO.matches ? "auto" : "smooth", block: "start" });
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
