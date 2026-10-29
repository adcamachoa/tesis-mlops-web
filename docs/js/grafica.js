// La gráfica de venta real y pronóstico, con Chart.js (vendor/chart.umd.min.js, que se carga antes que este módulo).
// Los colores salen de las variables de estilos.css, así que siguen el modo claro u oscuro. Además del color, cada línea
// tiene su trazo: continua la venta real, a rayas el pronóstico, punteada el año anterior y de raya y punto, en un azul
// más tenue, el pronóstico anterior. La venta real sigue después del corte en las semanas pronosticadas que ya cerraron.

import { semanasGrafica } from "./datos.js?v=06557bc6";
import { fecha, fechaCorta, indice, nombreSerie } from "./formato.js?v=06557bc6";

const FUENTE = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const OSCURO = window.matchMedia("(prefers-color-scheme: dark)");

function colores() {
  const estilo = getComputedStyle(document.documentElement);
  const variable = (nombre) => estilo.getPropertyValue(nombre).trim();
  return {
    real: variable("--linea-real"),
    pronostico: variable("--linea-pronostico"),
    pronosticoAnterior: variable("--linea-pronostico-anterior"),
    anterior: variable("--linea-anterior"),
    superficie: variable("--superficie"),
    texto: variable("--texto"),
    texto2: variable("--texto-2"),
    suave: variable("--texto-suave"),
    cuadricula: variable("--cuadricula"),
    eje: variable("--eje"),
  };
}

function lineaVertical(ctx, x, area, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, area.top);
  ctx.lineTo(x, area.bottom);
  ctx.stroke();
  ctx.restore();
}

// El corte entre la última semana real y la primera de pronóstico, detrás de las líneas, y la guía vertical de la
// semana que está bajo el mouse, encima.
const guias = {
  id: "guias",
  beforeDatasetsDraw(chart, _args, opciones) {
    const { ctx, chartArea, scales } = chart;
    const x = (scales.x.getPixelForValue(opciones.corte) + scales.x.getPixelForValue(opciones.corte + 1)) / 2;
    lineaVertical(ctx, x, chartArea, opciones.color);
    ctx.save();
    ctx.font = `12px ${FUENTE}`;
    const [antes, despues] = ["← Venta real", "Pronóstico →"];
    // en pantallas angostas no caben: se omiten en vez de cortarlas, y la leyenda dice lo mismo
    const caben =
      x - 6 - ctx.measureText(antes).width >= chartArea.left && x + 6 + ctx.measureText(despues).width <= chartArea.right;
    if (caben) {
      ctx.fillStyle = opciones.colorTexto;
      ctx.textBaseline = "top";
      ctx.textAlign = "right";
      ctx.fillText(antes, x - 6, chartArea.top + 2);
      ctx.textAlign = "left";
      ctx.fillText(despues, x + 6, chartArea.top + 2);
    }
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, opciones) {
    const [activo] = chart.tooltip?.getActiveElements() ?? [];
    if (activo) lineaVertical(chart.ctx, activo.element.x, chart.chartArea, opciones.color);
  },
};

function linea(etiqueta, datos, color, extra) {
  return {
    label: etiqueta,
    data: datos,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    borderCapStyle: "round",
    borderJoinStyle: "round",
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBorderWidth: 2,
    tension: 0,
    ...extra,
  };
}

function configuracion(resultados, serie, ver) {
  const c = colores();
  const semanas = semanasGrafica(resultados, serie);
  const columna = (campo) => semanas.map((semana) => semana[campo]);
  // el pronóstico arranca en la última semana real para que las dos líneas se unan; ese punto no va en el tooltip
  const union = resultados.semanas.real.length - 1;
  const pronostico = columna("pronostico").map((valor, i) => (i === union ? serie.real[union] : valor));
  const anillo = { pointHoverBorderColor: c.superficie };
  return {
    type: "line",
    data: {
      labels: columna("semana"),
      datasets: [
        linea("Pronóstico", pronostico, c.pronostico, {
          ...anillo,
          borderDash: [6, 4],
          order: 0,
        }),
        linea("Venta real", columna("real"), c.real, { ...anillo, order: 1 }),
        linea("Año anterior", columna("anioAnterior"), c.anterior, {
          ...anillo,
          borderDash: [1, 4],
          hidden: !ver.anioAnterior,
          order: 2,
        }),
        // raya y punto: con las puntas redondas, la raya de 7 y el punto de 1 se ven de 9 y 3, con 3 entre ellos
        linea("Pronóstico anterior", columna("pronosticoAnterior"), c.pronosticoAnterior, {
          ...anillo,
          borderDash: [7, 5, 1, 5],
          hidden: !ver.pronosticoAnterior,
          order: 3,
        }),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { display: false },
          border: { color: c.eje },
          ticks: {
            color: c.suave,
            maxRotation: 0,
            autoSkipPadding: 16,
            callback(valor) {
              return fechaCorta(this.getLabelForValue(valor));
            },
          },
        },
        y: {
          beginAtZero: true,
          grace: "10%",
          grid: { color: c.cuadricula },
          border: { display: false },
          ticks: { color: c.suave, callback: (valor) => indice(valor, 0) },
          title: { display: true, text: "Índice", color: c.texto2 },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.superficie,
          borderColor: c.eje,
          borderWidth: 1,
          titleColor: c.texto,
          bodyColor: c.texto2,
          padding: 10,
          boxPadding: 4,
          filter: (item) => item.parsed.y !== null && !(item.dataset.label === "Pronóstico" && item.dataIndex === union),
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          callbacks: {
            title: (items) => `Semana del ${fecha(items[0].label)}`,
            label: (item) => `${item.dataset.label}: ${indice(item.parsed.y)}`,
          },
        },
        guias: { corte: union, color: c.eje, colorTexto: c.texto2 },
      },
    },
    plugins: [guias],
  };
}

/**
 * Crea la gráfica en `lienzo`. `mostrar` la vuelve a dibujar con otra serie, y `redibujar` con los colores del tema
 * elegido; si el tema sigue al sistema, también se redibuja sola cuando el sistema cambia de modo.
 */
export function crearGrafica(lienzo) {
  let grafica = null;
  let actual = null;

  function dibujar() {
    const { resultados, serie, ver } = actual;
    grafica?.destroy();
    window.Chart.defaults.font.family = FUENTE;
    grafica = new window.Chart(lienzo, configuracion(resultados, serie, ver));
    lienzo.setAttribute("aria-label", `Venta real y pronóstico de ${nombreSerie(serie.nombre)}, en índice`);
  }

  OSCURO.addEventListener("change", () => actual && dibujar());
  return {
    /** `ver` dice qué líneas de referencia se muestran: `{ anioAnterior, pronosticoAnterior }`. */
    mostrar(resultados, serie, ver) {
      actual = { resultados, serie, ver };
      dibujar();
    },
    redibujar() {
      if (actual) dibujar();
    },
  };
}
