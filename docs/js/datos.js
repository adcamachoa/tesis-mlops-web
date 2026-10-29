// Lee y revisa manifest.json y results.json, y hace los cálculos de la página. Sin DOM: se prueba con node --test.
//
// El formato de results.json lo define tesis-mlops en src/common/results_schema.py. Aquí solo se revisa lo que la
// página necesita para no dibujar datos mal; si algo no cuadra, se lanza ErrorDatos con un mensaje para el lector.
//
// La versión 1 trae el total, las submarcas y las series de más venta. La 2 trae el árbol total → submarca →
// departamento → categoría → serie (tipo de producto), cada nodo con su id, su padre y las métricas del backtest a su
// nivel. Lo que no se publica por separado (lo que no llega al mínimo y, si hace falta, el hijo publicado más chico) va
// junto en un nodo «otras», así que los hijos de un nodo siempre lo suman. En la versión 2 la página no calcula restos
// entre nodos: muestra solo lo que viene publicado.
//
// La venta real del horizonte (real_hasta y, en cada serie, real_horizonte, ventanas_real y pronostico_anterior) llegó
// después dentro de la versión 1: los archivos de antes no la traen y la página se ve como antes (ver tieneVentaReal).
// En la versión 2 siempre viene.

export const VERSION_MANIFEST = 1;
export const VERSIONES_ESQUEMA = [1, 2];
export const METRICAS_ESTANDAR = ["wape_m1", "wape_m2", "wape_total", "mape_m1", "mape_m2", "mape_total", "sesgo_total"];
export const METRICAS_COMPLEMENTO = ["wape_tipo_mes", "mae", "rmse"];
const NIVELES_V1 = ["total", "submarca", "serie"];
export const NIVELES = ["total", "submarca", "departamento", "categoria", "serie"]; // los de la versión 2
const OTRAS = "otras"; // junta lo de un padre que no se publica por separado; no se desglosa
const CAMPOS_VENTA_REAL = ["real_horizonte", "ventanas_real", "pronostico_anterior"]; // en cada serie, con real_hasta
const DIAS_ANIO = 364; // 52 semanas: la misma semana del año anterior, también de lunes a domingo

const ID = /^[a-z0-9-]+$/;
const ID_NODO = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/; // la ruta del nodo: submarca-a/departamento-1
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

/** Como revisarValores, pero con null donde el valor no se conoce. Con `conocidos`, el valor va justo donde dice. */
function revisarConNulos(problemas, ruta, valores, largo, que, conocidos = null) {
  if (!Array.isArray(valores) || valores.length !== largo || !valores.every((v) => v === null || esIndice(v))) {
    problemas.push(`${ruta}: tiene que traer ${largo} valores, números mayores o iguales a 0 o null, uno por ${que}`);
  } else if (conocidos && valores.some((valor, i) => (valor !== null) !== conocidos[i])) {
    problemas.push(`${ruta}: tiene que traer valor justo en lo que cerró hasta real_hasta y null en lo demás`);
  }
}

/**
 * El árbol de la versión 2: ids que no se repiten, solo el total sin padre y cada padre antes que sus hijos (así no hay
 * ciclos), un nivel arriba de ellos o con «otras» entre sus hijos. «Otras» y los tipos de producto no tienen hijos.
 */
function revisarArbol(problemas, nodos) {
  const vistos = new Map();
  nodos.forEach((nodo, i) => {
    const ruta = `series/${i}`;
    if (vistos.has(nodo.id)) problemas.push(`${ruta}: el id ${nodo.id} aparece dos veces`);
    if ((nodo.nivel === "total") !== (nodo.padre === null)) {
      problemas.push(`${ruta}: solo el total va sin padre`);
    } else if (nodo.padre !== null) {
      const padre = vistos.get(nodo.padre);
      const debajo = nodo.nivel === OTRAS || NIVELES.indexOf(nodo.nivel) === NIVELES.indexOf(padre?.nivel) + 1;
      if (!padre) problemas.push(`${ruta}: su padre ${nodo.padre} no viene antes en series`);
      else if (padre.nivel === OTRAS || padre.nivel === "serie" || !debajo) {
        problemas.push(`${ruta}: un nodo ${nodo.nivel} no puede colgar de un nodo ${padre.nivel}`);
      }
    }
    vistos.set(nodo.id, nodo);
  });
}

/** Si el archivo trae la venta real del horizonte. Los de antes no la traen, y la página se ve como antes. */
export const tieneVentaReal = (resultados) => "real_hasta" in resultados;

/**
 * Qué semanas y qué meses del pronóstico ya cerraron hasta real_hasta (el último domingo con venta real): ahí va la
 * venta real y en el resto, null.
 */
export function cerrados({ real_hasta: hasta, semanas, ventanas }) {
  return {
    semanas: semanas.pronostico.map((semana) => sumarDias(semana, 6) <= hasta),
    ventanas: ventanas.map((ventana) => ventana.hasta <= hasta),
  };
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
  const version = resultados.version_esquema;
  if (!VERSIONES_ESQUEMA.includes(version)) throw new ErrorDatos(mensajeVersion(version));
  const problemas = [];
  revisarCampos(problemas, "(raíz)", resultados, { generado: esFechaHora, escala: esTexto });
  if (version === 2 && !(esIndice(resultados.indice_minimo) && resultados.indice_minimo > 0)) {
    problemas.push("indice_minimo: falta o no es un número mayor que 0");
  }
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
  const estandar = Object.fromEntries(METRICAS_ESTANDAR.map((m) => [m, esMetrica]));
  const complemento = Object.fromEntries(METRICAS_COMPLEMENTO.map((m) => [m, esMetrica]));
  const conMetricas = revisarLista(problemas, "metricas", resultados.metricas, (fila, ruta) =>
    revisarCampos(problemas, ruta, fila, {
      modelo: esTexto,
      ...estandar,
      ...complemento,
      es_mejor: esBooleano,
      es_champion: esBooleano,
    }),
  );
  // en la versión 2, cada nodo trae los mismos modelos que la raíz y en el mismo orden
  const modelos = conMetricas ? JSON.stringify(resultados.metricas.map((fila) => fila?.modelo)) : null;
  const semanas = resultados.semanas;
  const fecha = (valor, ruta) => esFecha(valor) || problemas.push(`${ruta}: no es una fecha`);
  const conSemanas =
    revisarCampos(problemas, "semanas", semanas, {}) &&
    revisarLista(problemas, "semanas/real", semanas.real, fecha) &&
    revisarLista(problemas, "semanas/pronostico", semanas.pronostico, fecha);
  const conVentanas = revisarLista(problemas, "ventanas", resultados.ventanas, (ventana, ruta) =>
    revisarCampos(problemas, ruta, ventana, { numero: esEntero, desde: esFecha, hasta: esFecha, dias: esEntero }),
  );
  // la venta real del horizonte: todo o nada (en la versión 2, siempre); si viene, cada valor justo en lo que cerró
  // hasta real_hasta
  const conVentaReal = version === 2 || tieneVentaReal(resultados);
  const hasta = resultados.real_hasta;
  if (conVentaReal && !esFecha(hasta)) problemas.push("real_hasta: falta o no es una fecha");
  else if (conVentaReal && esFecha(resultados.corrida?.datos_hasta) && hasta < resultados.corrida.datos_hasta) {
    problemas.push("real_hasta: es anterior a datos_hasta");
  }
  const conocidos =
    conVentaReal && esFecha(hasta) && conSemanas && conVentanas && resultados.ventanas.every(esObjeto)
      ? cerrados(resultados)
      : null;
  const camposNodo =
    version === 1
      ? { nivel: (v) => NIVELES_V1.includes(v), nombre: esTexto }
      : {
          id: (v) => typeof v === "string" && ID_NODO.test(v),
          padre: (v) => v === null || (typeof v === "string" && ID_NODO.test(v)),
          nivel: (v) => NIVELES.includes(v) || v === OTRAS,
          nombre: esTexto,
          etiqueta: esTexto,
        };
  revisarLista(problemas, "series", resultados.series, (serie, ruta) => {
    if (!revisarCampos(problemas, ruta, serie, camposNodo)) return;
    if (version === 2) {
      const conModelos = revisarLista(problemas, `${ruta}/metricas`, serie.metricas, (fila, rutaFila) =>
        revisarCampos(problemas, rutaFila, fila, { modelo: esTexto, ...estandar }),
      );
      if (conModelos && modelos && JSON.stringify(serie.metricas.map((fila) => fila?.modelo)) !== modelos) {
        problemas.push(`${ruta}/metricas: no trae los mismos modelos que metricas, en el mismo orden`);
      }
    }
    if (conSemanas) {
      revisarValores(problemas, `${ruta}/real`, serie.real, semanas.real.length, "semana real");
      revisarValores(problemas, `${ruta}/pronostico`, serie.pronostico, semanas.pronostico.length, "semana de pronóstico");
    }
    if (conVentanas) revisarValores(problemas, `${ruta}/ventanas`, serie.ventanas, resultados.ventanas.length, "mes");
    if (!conVentaReal) {
      const sueltos = CAMPOS_VENTA_REAL.filter((campo) => campo in serie);
      if (sueltos.length) problemas.push(`${ruta}: trae ${sueltos.join(", ")}, pero el archivo no trae real_hasta`);
      return;
    }
    if (conSemanas) {
      const [horizonte, reales] = [semanas.pronostico.length, semanas.real.length];
      const anteriores = serie.pronostico_anterior;
      revisarConNulos(problemas, `${ruta}/real_horizonte`, serie.real_horizonte, horizonte, "semana de pronóstico",
        conocidos?.semanas);
      revisarConNulos(problemas, `${ruta}/pronostico_anterior`, anteriores, reales, "semana real");
    }
    if (conVentanas) {
      const meses = resultados.ventanas.length;
      revisarConNulos(problemas, `${ruta}/ventanas_real`, serie.ventanas_real, meses, "mes", conocidos?.ventanas);
    }
  });
  if (Array.isArray(resultados.series)) {
    const totales = resultados.series.filter((serie) => serie?.nivel === "total").length;
    if (totales !== 1) problemas.push(`series: tiene que haber una sola serie total y hay ${totales}`);
  }
  if (version === 2 && problemas.length === 0) revisarArbol(problemas, resultados.series);
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

/** Las series de la versión 1 agrupadas por nivel, en el orden en que vienen. */
export function porNivel(series) {
  return Object.fromEntries(NIVELES_V1.map((nivel) => [nivel, series.filter((serie) => serie.nivel === nivel)]));
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

/** Cuántas semanas pronosticadas ya tienen venta real. Null si el archivo no trae la venta real del horizonte. */
export function semanasConVentaReal(resultados) {
  return tieneVentaReal(resultados) ? cerrados(resultados).semanas.filter(Boolean).length : null;
}

/**
 * Las semanas de la gráfica de una serie, en orden: las 52 reales y las del pronóstico. Cada una trae la venta real,
 * el pronóstico, la venta del año anterior y el pronóstico anterior (el que estaba vigente, de un origen previo), con
 * null donde no hay. `pendiente` marca las semanas pronosticadas que todavía no cierran. Sin la venta real del
 * horizonte (archivos de antes), después del origen no hay venta real, no hay pronóstico anterior y nada queda pendiente.
 */
export function semanasGrafica(resultados, serie) {
  const conVentaReal = tieneVentaReal(resultados);
  const previo = anioAnterior(resultados, serie);
  return [
    ...resultados.semanas.real.map((semana, i) => ({
      semana,
      tipo: "real",
      real: serie.real[i],
      pronostico: null,
      anioAnterior: null,
      pronosticoAnterior: conVentaReal ? serie.pronostico_anterior[i] : null,
      pendiente: false,
    })),
    ...resultados.semanas.pronostico.map((semana, i) => ({
      semana,
      tipo: "pronostico",
      real: conVentaReal ? serie.real_horizonte[i] : null,
      pronostico: serie.pronostico[i],
      anioAnterior: previo[i],
      pronosticoAnterior: null,
      pendiente: conVentaReal && serie.real_horizonte[i] === null,
    })),
  ];
}

/** Si alguna semana trae pronóstico anterior: las semanas con valor son las mismas en todas las series. */
export function tienePronosticoAnterior(resultados) {
  return tieneVentaReal(resultados) && resultados.series.some((s) => s.pronostico_anterior.some((v) => v !== null));
}

const suma = (valores) => valores.reduce((total, valor) => total + valor, 0);

/** Un periodo de `dias` días llevado a semana promedio: la misma escala de la gráfica, donde 100 es una semana promedio. */
export const semanaPromedio = (valor, dias) => (valor * 7) / dias;

/** (pronóstico − real) / real, como el sesgo: positiva si se pronosticó de más. Null sin venta real (o si es 0). */
export const diferencia = (pronostico, real) => (real ? pronostico / real - 1 : null);

/**
 * La fila de la vista por mes de una serie: semana promedio de cada mes y del trimestre. El año anterior se compara
 * solo en el trimestre: la venta real viene por semana y hay semanas partidas entre dos meses, así que por mes sería
 * una aproximación. Si falta alguna de las semanas del año anterior, la comparación queda vacía.
 *
 * Si el archivo trae la venta real del horizonte, la fila trae además, por mes y en el trimestre, la venta real como
 * semana promedio y la diferencia con el pronóstico; null mientras el periodo no cierra (el trimestre, hasta que cierran
 * los tres meses). Sin ella, `real` es null y la vista se ve como antes.
 */
export function filaPorMes(resultados, serie) {
  const semanas = serie.pronostico.length;
  const trimestre = suma(serie.pronostico) / semanas;
  const previo = anioAnterior(resultados, serie);
  const base = previo.every((valor) => valor !== null) ? suma(previo) / semanas : null;
  const dias = resultados.ventanas.map((ventana) => ventana.dias);
  let real = null;
  if (tieneVentaReal(resultados)) {
    const reales = serie.ventanas_real;
    const completo = reales.every((valor) => valor !== null);
    const [pronosticado, vendido] = [suma(serie.ventanas), completo ? suma(reales) : null];
    real = {
      meses: reales.map((valor, i) => (valor === null ? null : semanaPromedio(valor, dias[i]))),
      diferencias: reales.map((valor, i) => (valor === null ? null : diferencia(serie.ventanas[i], valor))),
      trimestre: completo ? semanaPromedio(vendido, suma(dias)) : null,
      diferenciaTrimestre: completo ? diferencia(pronosticado, vendido) : null,
    };
  }
  return {
    serie,
    meses: serie.ventanas.map((valor, i) => semanaPromedio(valor, dias[i])),
    trimestre,
    anioAnterior: base,
    variacion: base ? trimestre / base - 1 : null,
    real,
  };
}

/**
 * La submarca de una serie de la versión 1, leída de su nombre ("Submarca A | Departamento 1 | …"); esa versión no la
 * trae como campo. Si el nombre no tiene esa forma, null.
 */
export function submarcaDe(nombre) {
  const partes = nombre.split(" | ");
  return partes.length > 1 ? partes[0] : null;
}

/**
 * Las series de la versión 1 como nodos de un árbol, que esa versión no trae: el id es el nombre, cada serie cuelga de
 * la submarca que dice su nombre (o del total, si no dice una conocida) y la etiqueta es el nombre sin su submarca.
 */
function nodosVersion1(series) {
  const total = series.find((serie) => serie.nivel === "total").nombre;
  const submarcas = new Set(series.filter((serie) => serie.nivel === "submarca").map((serie) => serie.nombre));
  return series.map((serie) => {
    const submarca = serie.nivel === "serie" ? submarcaDe(serie.nombre) : null;
    const padre = serie.nivel === "total" ? null : submarcas.has(submarca) ? submarca : total;
    const etiqueta = submarcas.has(padre) ? serie.nombre.slice(padre.length + " | ".length) : serie.nombre;
    return { ...serie, id: serie.nombre, padre, etiqueta };
  });
}

/**
 * El árbol de un pronóstico, para el segmentador y el desglose: la raíz (el total), cada nodo por su id, los hijos de
 * un nodo en el orden en que vienen (en la versión 2, del más pesado al más liviano, con «otras» al final) y la ruta de
 * un nodo desde la raíz. En la versión 1 los nodos salen de nodosVersion1.
 */
export function arbol(resultados) {
  const version = resultados.version_esquema;
  const nodos = version === 1 ? nodosVersion1(resultados.series) : resultados.series;
  const porId = new Map(nodos.map((nodo) => [nodo.id, nodo]));
  const hijos = new Map(nodos.map((nodo) => [nodo.id, []]));
  for (const nodo of nodos) if (nodo.padre !== null) hijos.get(nodo.padre).push(nodo);
  return {
    version,
    raiz: nodos.find((nodo) => nodo.padre === null),
    nodo: (id) => porId.get(id) ?? null,
    hijos: (id) => hijos.get(id) ?? [],
    ruta(id) {
      const camino = [];
      for (let nodo = porId.get(id); nodo; nodo = porId.get(nodo.padre)) camino.unshift(nodo);
      return camino;
    },
  };
}

/**
 * Qué nodo mostrar al cambiar de pronóstico si se veía el nodo `id` del árbol `anterior`: el mismo, por su id, si el
 * árbol `nuevo` lo trae; si no, su ancestro más cercano que sí (el árbol se arma en cada origen, y un nodo puede no
 * publicarse por separado en otro), y si ninguno, la raíz. `movido` dice si no se encontró el mismo nodo, para avisarlo;
 * desde la raíz se llega a la raíz sin aviso.
 */
export function conservarNodo(anterior, id, nuevo) {
  if (nuevo.nodo(id)) return { id, movido: false };
  const cercano = anterior.ruta(id).reverse().find((nodo) => nuevo.nodo(nodo.id)) ?? nuevo.raiz;
  return { id: cercano.id, movido: id !== anterior.raiz.id };
}

/**
 * La tabla de modelos medida en un nodo de la versión 2, con el champion marcado por su nombre: el de la raíz, que es
 * el que hizo el pronóstico. Null en la versión 1, que no trae métricas por nodo.
 */
export function metricasDelNodo(resultados, nodo) {
  if (!nodo.metricas) return null;
  return nodo.metricas.map((fila) => ({ ...fila, es_champion: fila.modelo === resultados.champion.modelo }));
}

const redondear = (valor) => Math.round(valor * 10) / 10; // el índice viene con 1 decimal

/**
 * Lo que le falta a `padre` para sumar `partes`, valor por valor; nunca negativo (el redondeo puede pasarse). Null
 * donde el padre es null: lo que no se conoce no se conoce en ninguna serie. Solo para la versión 1.
 */
function resto(padre, partes, campo) {
  return padre[campo].map((valor, i) =>
    valor === null ? null : Math.max(0, redondear(valor - suma(partes.map((p) => p[campo][i])))),
  );
}

/**
 * Las partes en que se desglosa `nodo`, como nodos del árbol (con id y etiqueta). En la versión 2, sus hijos tal como
 * vienen, con «otras» al final: suman el nodo, y aquí no se calcula ningún resto. Un nodo sin hijos no se desglosa.
 *
 * En la versión 1, el total se desglosa en sus submarcas, y una submarca en las series principales que trae
 * results.json más "Otras series", que es la submarca menos esas series: el archivo solo trae las de más venta. "Otras
 * series" no está en el archivo, así que va sin id. Una serie no se desglosa, y tampoco una submarca sin series
 * reconocibles por el nombre.
 */
export function desglose(resultados, nodo) {
  const { hijos } = arbol(resultados);
  if (resultados.version_esquema !== 1) return hijos(nodo.id);
  if (nodo.nivel === "total") return hijos(nodo.nombre).filter((hijo) => hijo.nivel === "submarca");
  const propias = nodo.nivel === "submarca" ? hijos(nodo.nombre) : [];
  if (!propias.length) return [];
  const campos = ["real", "pronostico", "ventanas", ...(tieneVentaReal(resultados) ? CAMPOS_VENTA_REAL : [])];
  const otras = {
    id: null,
    nivel: "otras",
    nombre: `Otras series de ${nodo.nombre}`,
    etiqueta: "Otras series",
    ...Object.fromEntries(campos.map((campo) => [campo, resto(nodo, propias, campo)])),
  };
  const vacia = ["real", "pronostico", "ventanas"].every((campo) => otras[campo].every((valor) => valor === 0));
  return vacia ? propias : [...propias, otras];
}
