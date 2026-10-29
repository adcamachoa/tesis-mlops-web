// Arma el contenido de cada tabla de la página para exportarla a Excel: las mismas columnas que se ven, con los números
// como números (no como texto) y una hoja "Notas" con de dónde salen. Sin DOM: se prueba con node --test.

import { metricasDelNodo, semanasGrafica, tieneVentaReal } from "./datos.js?v=06557bc6";
import { cifra, enNivel, fecha, nombreSerie } from "./formato.js?v=06557bc6";

const FUENTE = "https://github.com/adcamachoa/tesis-mlops-web";
const indice = (valor) => ({ valor, formato: "indice" });
const porcentaje = (valor) => ({ valor, formato: "porcentaje" });
const variacion = (valor) => ({ valor, formato: "variacion" });
const redondear = (valor, decimales) => (valor === null ? null : Number(valor.toFixed(decimales)));

/** Un nombre de archivo seguro: sin tildes, en minúsculas y con guiones. */
export function enArchivo(texto) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function archivo(partes, resultados) {
  return `${[...partes.map(enArchivo), resultados.corrida.origen].join("_")}.xlsx`;
}

/** La hoja "Notas": qué tabla es, de qué pronóstico y en qué escala. */
function notas(resultados, tabla, { serie = null, sinteticos = false } = {}) {
  const { corrida, champion } = resultados;
  return {
    nombre: "Notas",
    encabezado: false,
    filas: [
      ["Tabla", tabla],
      serie && ["Serie", nombreSerie(serie)],
      ["Origen del pronóstico", fecha(corrida.origen)],
      ["Fecha del pronóstico", fecha(corrida.fecha_prediccion)],
      ["Datos hasta", fecha(corrida.datos_hasta)],
      tieneVentaReal(resultados) && ["Venta real hasta", fecha(resultados.real_hasta)],
      ["Modelo champion", `${champion.modelo} (versión ${champion.version})`],
      ["Escala", resultados.escala],
      "indice_minimo" in resultados && [
        "Mínimo publicado",
        `${cifra(resultados.indice_minimo)} de índice promedio semanal: «Otras» junta lo que no se publica por separado`,
      ],
      ["Generado", fecha(resultados.generado)],
      ["Fuente", FUENTE],
      sinteticos && ["Aviso", "Datos sintéticos de ejemplo: no son pronósticos reales."],
    ].filter(Boolean),
  };
}

const COLUMNAS_MODELOS = ["WAPE mes 1", "WAPE mes 2", "WAPE total", "Sesgo total"];
const metricasModelo = (fila) => [
  porcentaje(fila.wape_m1),
  porcentaje(fila.wape_m2),
  porcentaje(fila.wape_total),
  variacion(fila.sesgo_total),
];

/** La comparación oficial de modelos: WAPE de mes 1, mes 2 y total, y sesgo total, del backtest completo. */
export function exportarModelos(resultados, opciones = {}) {
  const filas = [
    ["Modelo", "Champion", "Mejor", ...COLUMNAS_MODELOS],
    ...resultados.metricas.map((fila) => [
      fila.modelo,
      fila.es_champion ? "sí" : "",
      fila.es_mejor ? "sí" : "",
      ...metricasModelo(fila),
    ]),
  ];
  const tabla = "Modelos en el backtest completo, a nivel tipo de producto (no cambia con la serie)";
  return {
    archivo: archivo(["modelos-backtest"], resultados),
    hojas: [{ nombre: "Modelos", filas }, notas(resultados, tabla, opciones)],
  };
}

/** La tabla de modelos medida en un nodo de la versión 2, con la venta y el pronóstico sumados a ese nodo. */
export function exportarModelosNodo(resultados, nodo, opciones = {}) {
  const filas = [
    ["Modelo", "Champion", ...COLUMNAS_MODELOS],
    ...metricasDelNodo(resultados, nodo).map((fila) => [
      fila.modelo,
      fila.es_champion ? "sí" : "",
      ...metricasModelo(fila),
    ]),
  ];
  const tabla = `Modelos en el backtest, medidos en la serie elegida (${enNivel(nodo.nivel)})`;
  return {
    archivo: archivo(["modelos", nodo.nombre], resultados),
    hojas: [{ nombre: "Modelos", filas }, notas(resultados, tabla, { ...opciones, serie: nodo.nombre })],
  };
}

/** Las métricas complementarias: WAPE tipo × mes (el criterio del mejor), MAE y RMSE en índice. */
export function exportarComplemento(resultados, opciones = {}) {
  const filas = [
    ["Modelo", "WAPE tipo × mes", "MAE (índice)", "RMSE (índice)"],
    ...resultados.metricas.map((fila) => [
      fila.modelo,
      porcentaje(fila.wape_tipo_mes),
      { valor: fila.mae, formato: "decimal2" }, // con 2 decimales, como en la página
      { valor: fila.rmse, formato: "decimal2" },
    ]),
  ];
  return {
    archivo: archivo(["metricas-complementarias"], resultados),
    hojas: [{ nombre: "Complemento", filas }, notas(resultados, "Métricas complementarias del backtest completo", opciones)],
  };
}

/**
 * Los datos de la gráfica de una serie, semana por semana: venta real, pronóstico y año anterior, en índice. Si el
 * archivo trae la venta real del horizonte, también el pronóstico anterior, y "pendiente" en la venta real de las
 * semanas pronosticadas que todavía no cierran.
 */
export function exportarGrafica(resultados, serie, opciones = {}) {
  const conVentaReal = tieneVentaReal(resultados);
  const celda = (valor) => (valor === null ? null : indice(valor));
  const filas = [
    ["Semana del", "Tipo", "Venta real (índice)", "Pronóstico (índice)", "Año anterior (índice)",
      ...(conVentaReal ? ["Pronóstico anterior (índice)"] : [])],
    ...semanasGrafica(resultados, serie).map((s) => [
      { valor: s.semana, formato: "fecha" },
      s.tipo === "real" ? "real" : "pronóstico",
      s.pendiente ? "pendiente" : celda(s.real),
      celda(s.pronostico),
      celda(s.anioAnterior),
      ...(conVentaReal ? [celda(s.pronosticoAnterior)] : []),
    ]),
  ];
  return {
    archivo: archivo(["grafica", serie.nombre], resultados),
    hojas: [
      { nombre: "Semanas", filas },
      notas(resultados, "Venta real y pronóstico, semana por semana", { ...opciones, serie: serie.nombre }),
    ],
  };
}

/**
 * La vista por mes de la serie elegida (`fila`) y su desglose (`partes`), como en la página. Si el archivo trae la
 * venta real del horizonte, cada periodo lleva tres columnas: pronóstico, venta real y diferencia ((pronóstico − real)
 * / real), con "pendiente" mientras el periodo no cierra.
 */
export function exportarPorMes(resultados, fila, partes, opciones = {}) {
  const { ventanas, semanas } = resultados;
  const conVentaReal = fila.real !== null;
  const periodos = [
    ...ventanas.map((v, i) => `Mes ${i + 1}: ${fecha(v.desde)} al ${fecha(v.hasta)}`),
    `Trimestre: ${semanas.pronostico.length} semanas`,
  ];
  const titulos = periodos.flatMap((periodo) =>
    conVentaReal
      ? [`${periodo}, pronóstico (semana promedio, índice)`, `${periodo}, venta real (semana promedio, índice)`,
        `${periodo}, diferencia ((pronóstico − real) / real)`]
      : [`${periodo} (semana promedio, índice)`],
  );
  const renglon = (f, rol) => {
    const pronosticos = [...f.meses, f.trimestre];
    const reales = conVentaReal ? [...f.real.meses, f.real.trimestre] : [];
    const diferencias = conVentaReal ? [...f.real.diferencias, f.real.diferenciaTrimestre] : [];
    return [
      nombreSerie(f.serie.nombre),
      rol,
      ...pronosticos.flatMap((valor, i) => {
        const pronosticado = indice(redondear(valor, 2));
        if (!conVentaReal) return [pronosticado];
        if (reales[i] === null) return [pronosticado, "pendiente", "pendiente"];
        return [pronosticado, indice(redondear(reales[i], 2)), variacion(redondear(diferencias[i], 4))];
      }),
      variacion(redondear(f.variacion, 4)),
    ];
  };
  const filas = [
    ["Serie", "Fila", ...titulos, "Contra año anterior (variación del trimestre, %)"],
    renglon(fila, "elegida"),
    ...partes.map((parte) => renglon(parte, "desglose")),
  ];
  return {
    archivo: archivo(["pronostico-por-mes", fila.serie.nombre], resultados),
    hojas: [
      { nombre: "Por mes", filas },
      notas(resultados, "Pronóstico por mes: semana promedio de cada periodo, en índice", {
        ...opciones,
        serie: fila.serie.nombre,
      }),
    ],
  };
}
