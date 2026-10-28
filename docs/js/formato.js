// Números, porcentajes y fechas en español, como en PLAN.md de tesis-mlops: 34,2 %, +4,2 %, −9,6 % y 28-oct-2026.

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const VACIO = "—";

function numero(valor, opciones) {
  if (valor === null || valor === undefined) return VACIO;
  const texto = new Intl.NumberFormat("es", opciones).format(valor);
  return texto.replace("-", "−"); // el signo menos tipográfico, del mismo ancho que el +
}

/** Un valor del índice, por defecto con 1 decimal: 98,4. */
export const indice = (valor, decimales = 1) =>
  numero(valor, { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

/** Una fracción como porcentaje: 0,342 → 34,2 %. */
export const porcentaje = (valor) =>
  numero(valor, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Una fracción como porcentaje con signo, para el sesgo y las variaciones: +4,2 %, −9,6 %. */
export const variacion = (valor) =>
  numero(valor, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });

/** "2026-10-28" o "2026-10-28T16:28:09" → "28-oct-2026". */
export function fecha(texto) {
  const [anio, mes, dia] = texto.slice(0, 10).split("-");
  return `${Number(dia)}-${MESES[Number(mes) - 1]}-${anio}`;
}

/** "2026-10-12" → "12-oct", para el eje de la gráfica. */
export const fechaCorta = (texto) => fecha(texto).slice(0, -5);

/** "Submarca A | Departamento 1 | Tipo 3" → "Submarca A › Departamento 1 › Tipo 3". */
export const nombreSerie = (nombre) => nombre.split(" | ").join(" › ");
