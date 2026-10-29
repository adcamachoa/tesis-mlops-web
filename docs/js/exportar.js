// Arma el contenido de cada tabla de la página para exportarla a Excel: las mismas columnas que se ven, con los números
// como números (no como texto) y una hoja "Notas" con de dónde salen. Sin DOM: se prueba con node --test.

import { anioAnterior } from "./datos.js";
import { fecha, nombreSerie } from "./formato.js";

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
      ["Modelo champion", `${champion.modelo} (versión ${champion.version})`],
      ["Escala", resultados.escala],
      ["Generado", fecha(resultados.generado)],
      ["Fuente", FUENTE],
      sinteticos && ["Aviso", "Datos sintéticos de ejemplo: no son pronósticos reales."],
    ].filter(Boolean),
  };
}

/** La tabla de modelos: WAPE de mes 1, mes 2 y total, y sesgo total, del backtest completo. */
export function exportarModelos(resultados, opciones = {}) {
  const filas = [
    ["Modelo", "Champion", "Mejor", "WAPE mes 1", "WAPE mes 2", "WAPE total", "Sesgo total"],
    ...resultados.metricas.map((fila) => [
      fila.modelo,
      fila.es_champion ? "sí" : "",
      fila.es_mejor ? "sí" : "",
      porcentaje(fila.wape_m1),
      porcentaje(fila.wape_m2),
      porcentaje(fila.wape_total),
      variacion(fila.sesgo_total),
    ]),
  ];
  const tabla = "Modelos en el backtest completo, a nivel tipo de producto (no cambia con la serie)";
  return {
    archivo: archivo(["modelos-backtest"], resultados),
    hojas: [{ nombre: "Modelos", filas }, notas(resultados, tabla, opciones)],
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

/** Los datos de la gráfica de una serie, semana por semana: venta real, pronóstico y año anterior, en índice. */
export function exportarGrafica(resultados, serie, opciones = {}) {
  const { real, pronostico } = resultados.semanas;
  const previo = anioAnterior(resultados, serie);
  const filas = [
    ["Semana del", "Tipo", "Venta real (índice)", "Pronóstico (índice)", "Año anterior (índice)"],
    ...real.map((semana, i) => [{ valor: semana, formato: "fecha" }, "real", indice(serie.real[i]), null, null]),
    ...pronostico.map((semana, i) => [
      { valor: semana, formato: "fecha" },
      "pronóstico",
      null,
      indice(serie.pronostico[i]),
      indice(previo[i]),
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

/** La vista por mes de la serie elegida (`fila`) y su desglose (`partes`), como en la página. */
export function exportarPorMes(resultados, fila, partes, opciones = {}) {
  const { ventanas, semanas } = resultados;
  const meses = ventanas.map(
    (v, i) => `Mes ${i + 1}: ${fecha(v.desde)} al ${fecha(v.hasta)} (semana promedio, índice)`,
  );
  const renglon = (f, rol) => [
    nombreSerie(f.serie.nombre),
    rol,
    ...f.meses.map((valor) => indice(redondear(valor, 2))),
    indice(redondear(f.trimestre, 2)),
    variacion(redondear(f.variacion, 4)),
  ];
  const filas = [
    ["Serie", "Fila", ...meses, `Trimestre: ${semanas.pronostico.length} semanas (semana promedio, índice)`,
      "Contra año anterior (variación del trimestre, %)"],
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
