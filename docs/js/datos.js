// Lee y revisa manifest.json y results.json, y hace los cálculos de la página. Sin DOM: se prueba con node --test.
//
// El formato de results.json lo define tesis-mlops en src/common/results_schema.py. Aquí solo se revisa lo que la
// página necesita para no dibujar datos mal; si algo no cuadra, se lanza ErrorDatos con un mensaje para el lector.

export const VERSION_MANIFEST = 1;
export const VERSIONES_ESQUEMA = [1];
export const METRICAS_ESTANDAR = ["wape_m1", "wape_m2", "wape_total", "mape_m1", "mape_m2", "mape_total", "sesgo_total"];
export const METRICAS_COMPLEMENTO = ["wape_tipo_mes", "mae", "rmse"];
const NIVELES = ["total", "submarca", "serie"];
const DIAS_ANIO = 364; // 52 semanas: la misma semana del año anterior, también de lunes a domingo

const ID = /^[a-z0-9-]+$/;
// relativa al manifest: cada parte empieza con letra o número, así que no hay "..", "/" inicial ni "https:"
const RUTA = /^([A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/;

export class ErrorDatos extends Error {
  constructor(mensaje, detalles = []) {
    super(mensaje);
    this.name = "ErrorDatos";
    this.detalles = detalles;
  }
}

const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);
const esTexto = (valor) => typeof valor === "string" && valor.length > 0;
const esEntero = (valor) => Number.isInteger(valor) && valor >= 1;
const esBooleano = (valor) => typeof valor === "boolean";
const esIndice = (valor) => typeof valor === "number" && Number.isFinite(valor) && valor >= 0;
const esMetrica = (valor) => valor === null || (typeof valor === "number" && Number.isFinite(valor));

/** "aaaa-mm-dd" y que exista (no "2026-13-45"). */
export function esFecha(valor) {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) && sumarDias(valor, 0) === valor;
}

const esFechaHora = (valor) =>
  typeof valor === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(valor) && esFecha(valor.slice(0, 10));

/** Suma `dias` a una fecha "aaaa-mm-dd", en UTC para que el huso horario no corra el día. */
export function sumarDias(fecha, dias) {
  const dia = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(dia.getTime())) return null;
  dia.setUTCDate(dia.getUTCDate() + dias);
  return dia.toISOString().slice(0, 10);
}

function revisarCampos(problemas, ruta, objeto, campos) {
  if (!esObjeto(objeto)) {
    problemas.push(`${ruta}: falta o no es un objeto`);
    return false;
  }
  for (const [campo, valido] of Object.entries(campos)) {
    if (!valido(objeto[campo])) problemas.push(`${ruta}/${campo}: falta o no es válido`);
  }
  return true;
}

function revisarLista(problemas, ruta, lista, revisarElemento) {
  if (!Array.isArray(lista) || lista.length === 0) {
    problemas.push(`${ruta}: falta o está vacía`);
    return false;
  }
  lista.forEach((elemento, i) => revisarElemento(elemento, `${ruta}/${i}`));
  return true;
}

function revisarValores(problemas, ruta, valores, largo, que) {
  if (!Array.isArray(valores) || valores.length !== largo || !valores.every(esIndice)) {
    problemas.push(`${ruta}: tiene que traer ${largo} números mayores o iguales a 0, uno por ${que}`);
  }
}

/**
 * Las entradas del manifest, de la más reciente a la más antigua, cada una con `soportado` según su versión de
 * results.json. Hay una entrada por origen: si un origen se corrió dos veces, el manifest trae solo la última corrida.
 */
export function revisarManifest(manifest) {
  if (!esObjeto(manifest)) throw new ErrorDatos("La lista de pronósticos no tiene la forma esperada.");
  const version = manifest.version_manifest;
  if (version !== VERSION_MANIFEST) {
    throw new ErrorDatos(
      Number.isInteger(version)
        ? `La lista de pronósticos viene en el formato versión ${version} y esta página solo sabe leer la versión ` +
            `${VERSION_MANIFEST}.`
        : "La lista de pronósticos no dice en qué formato viene.",
    );
  }
  const problemas = [];
  if (!esFechaHora(manifest.generado)) problemas.push("generado: falta o no es válido");
  revisarLista(problemas, "pronosticos", manifest.pronosticos, (entrada, ruta) =>
    revisarCampos(problemas, ruta, entrada, {
      id: (v) => typeof v === "string" && ID.test(v),
      ruta: (v) => typeof v === "string" && RUTA.test(v),
      version_esquema: esEntero,
      origen: esFecha,
      fecha_prediccion: esFechaHora,
    }),
  );
  if (problemas.length === 0) {
    for (const campo of ["id", "origen"]) {
      const vistos = new Set();
      for (const entrada of manifest.pronosticos) {
        if (vistos.has(entrada[campo])) problemas.push(`pronosticos: el ${campo} ${entrada[campo]} aparece dos veces`);
        vistos.add(entrada[campo]);
      }
    }
  }
  if (problemas.length) throw new ErrorDatos("La lista de pronósticos no tiene la forma esperada.", problemas);
  return manifest.pronosticos
    .map((entrada) => ({ ...entrada, soportado: VERSIONES_ESQUEMA.includes(entrada.version_esquema) }))
    .sort((a, b) => b.origen.localeCompare(a.origen));
}

/** La entrada pedida si la página la sabe leer; si no, la más reciente que sí. Null si no puede leer ninguna. */
export function elegirPronostico(entradas, id) {
  const soportadas = entradas.filter((entrada) => entrada.soportado);
  return soportadas.find((entrada) => entrada.id === id) ?? soportadas[0] ?? null;
}

/** La URL del results.json de una entrada, junto al manifest. Nunca sale de la carpeta del manifest. */
export function urlPronostico(urlManifest, entrada) {
  const carpeta = new URL(".", urlManifest);
  const url = new URL(entrada.ruta, carpeta);
  if (!url.href.startsWith(carpeta.href)) throw new ErrorDatos("La ruta del pronóstico sale de la carpeta de datos.");
  return url;
}

export function mensajeVersion(version) {
  const conocidas = VERSIONES_ESQUEMA.join(" o ");
  return Number.isInteger(version)
    ? `Este pronóstico viene en el formato versión ${version} y esta página solo sabe leer la versión ${conocidas}. ` +
        "No se muestra para no dibujar datos mal."
    : "El pronóstico no dice en qué formato viene, así que no se muestra.";
}

/**
 * Revisa un results.json ya leído y lo devuelve. Con `entrada`, revisa además que sea el pronóstico que dice el
 * manifest. Lanza ErrorDatos con todos los problemas que encuentre.
 */
export function revisarResultados(resultados, entrada = null) {
  if (!esObjeto(resultados)) throw new ErrorDatos("El pronóstico no tiene la forma esperada.");
  if (!VERSIONES_ESQUEMA.includes(resultados.version_esquema)) {
    throw new ErrorDatos(mensajeVersion(resultados.version_esquema));
  }
  const problemas = [];
  revisarCampos(problemas, "(raíz)", resultados, { generado: esFechaHora, escala: esTexto });
  revisarCampos(problemas, "corrida", resultados.corrida, {
    fecha_prediccion: esFechaHora,
    fecha_entrenamiento: esFechaHora,
    origen: esFecha,
    datos_hasta: esFecha,
  });
  revisarCampos(problemas, "champion", resultados.champion, { modelo: esTexto, version: esEntero });
  revisarCampos(problemas, "backtest", resultados.backtest, {
    origenes: esEntero,
    primer_origen: esFecha,
    ultimo_origen: esFecha,
  });
  const metrica = Object.fromEntries([...METRICAS_ESTANDAR, ...METRICAS_COMPLEMENTO].map((m) => [m, esMetrica]));
  revisarLista(problemas, "metricas", resultados.metricas, (fila, ruta) =>
    revisarCampos(problemas, ruta, fila, { modelo: esTexto, ...metrica, es_mejor: esBooleano, es_champion: esBooleano }),
  );
  const semanas = resultados.semanas;
  const fecha = (valor, ruta) => esFecha(valor) || problemas.push(`${ruta}: no es una fecha`);
  const conSemanas =
    revisarCampos(problemas, "semanas", semanas, {}) &&
    revisarLista(problemas, "semanas/real", semanas.real, fecha) &&
    revisarLista(problemas, "semanas/pronostico", semanas.pronostico, fecha);
  const conVentanas = revisarLista(problemas, "ventanas", resultados.ventanas, (ventana, ruta) =>
    revisarCampos(problemas, ruta, ventana, { numero: esEntero, desde: esFecha, hasta: esFecha, dias: esEntero }),
  );
  revisarLista(problemas, "series", resultados.series, (serie, ruta) => {
    if (!revisarCampos(problemas, ruta, serie, { nivel: (v) => NIVELES.includes(v), nombre: esTexto })) return;
    if (conSemanas) {
      revisarValores(problemas, `${ruta}/real`, serie.real, semanas.real.length, "semana real");
      revisarValores(problemas, `${ruta}/pronostico`, serie.pronostico, semanas.pronostico.length, "semana de pronóstico");
    }
    if (conVentanas) revisarValores(problemas, `${ruta}/ventanas`, serie.ventanas, resultados.ventanas.length, "mes");
  });
  if (Array.isArray(resultados.series)) {
    const totales = resultados.series.filter((serie) => serie?.nivel === "total").length;
    if (totales !== 1) problemas.push(`series: tiene que haber una sola serie total y hay ${totales}`);
  }
  if (problemas.length) {
    throw new ErrorDatos("El pronóstico no tiene la forma esperada, así que no se muestra para no dibujar datos mal.", problemas);
  }
  const { origen, fecha_prediccion: prediccion } = resultados.corrida;
  if (entrada && (origen !== entrada.origen || prediccion !== entrada.fecha_prediccion)) {
    throw new ErrorDatos("El archivo no corresponde al pronóstico de la lista, así que no se muestra.", [
      `la lista dice origen ${entrada.origen} y predicción ${entrada.fecha_prediccion}`,
      `el archivo trae origen ${origen} y predicción ${prediccion}`,
    ]);
  }
  return resultados;
}

/** Las series agrupadas por nivel, en el orden en que vienen. */
export function porNivel(series) {
  return Object.fromEntries(NIVELES.map((nivel) => [nivel, series.filter((serie) => serie.nivel === nivel)]));
}

/**
 * La venta real de las mismas semanas del año anterior (52 semanas antes), una por semana de pronóstico. Null donde esa
 * semana no está entre las semanas reales.
 */
export function anioAnterior(resultados, serie) {
  const posicion = new Map(resultados.semanas.real.map((semana, i) => [semana, i]));
  return resultados.semanas.pronostico.map((semana) => {
    const i = posicion.get(sumarDias(semana, -DIAS_ANIO));
    return i === undefined ? null : serie.real[i];
  });
}

const suma = (valores) => valores.reduce((total, valor) => total + valor, 0);

/** Un periodo de `dias` días llevado a semana promedio: la misma escala de la gráfica, donde 100 es una semana promedio. */
export const semanaPromedio = (valor, dias) => (valor * 7) / dias;

/**
 * La fila de la vista por mes de una serie: semana promedio de cada mes y del trimestre. El año anterior se compara
 * solo en el trimestre: la venta real viene por semana y hay semanas partidas entre dos meses, así que por mes sería
 * una aproximación. Si falta alguna de las semanas del año anterior, la comparación queda vacía.
 */
export function filaPorMes(resultados, serie) {
  const semanas = serie.pronostico.length;
  const trimestre = suma(serie.pronostico) / semanas;
  const previo = anioAnterior(resultados, serie);
  const base = previo.every((valor) => valor !== null) ? suma(previo) / semanas : null;
  return {
    serie,
    meses: serie.ventanas.map((valor, i) => semanaPromedio(valor, resultados.ventanas[i].dias)),
    trimestre,
    anioAnterior: base,
    variacion: base ? trimestre / base - 1 : null,
  };
}

/**
 * La submarca de una serie, leída de su nombre ("Submarca A | Departamento 1 | …"). results.json todavía no la trae
 * como campo; si el nombre no tiene esa forma, null.
 */
export function submarcaDe(nombre) {
  const partes = nombre.split(" | ");
  return partes.length > 1 ? partes[0] : null;
}

const redondear = (valor) => Math.round(valor * 10) / 10; // el índice viene con 1 decimal

/** Lo que le falta a `padre` para sumar `partes`, valor por valor; nunca negativo (el redondeo puede pasarse). */
function resto(padre, partes, campo) {
  return padre[campo].map((valor, i) => Math.max(0, redondear(valor - suma(partes.map((p) => p[campo][i])))));
}

/**
 * Las series en que se desglosa `serie`. El total, en sus submarcas. Una submarca, en las series principales que trae
 * results.json más "Otras series", que es la submarca menos esas series: el archivo solo trae las de más venta. Una
 * serie no se desglosa, y tampoco una submarca sin series reconocibles por el nombre.
 */
export function desglose(resultados, serie) {
  const grupos = porNivel(resultados.series);
  if (serie.nivel === "total") return grupos.submarca;
  if (serie.nivel !== "submarca") return [];
  const propias = grupos.serie.filter((s) => submarcaDe(s.nombre) === serie.nombre);
  if (!propias.length) return [];
  const otras = {
    nivel: "otras",
    nombre: `Otras series de ${serie.nombre}`,
    real: resto(serie, propias, "real"),
    pronostico: resto(serie, propias, "pronostico"),
    ventanas: resto(serie, propias, "ventanas"),
  };
  const vacia = ["real", "pronostico", "ventanas"].every((campo) => otras[campo].every((valor) => valor === 0));
  return vacia ? propias : [...propias, otras];
}
