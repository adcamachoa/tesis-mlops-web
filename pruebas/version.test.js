// Pruebas de la versión en las rutas (herramientas/version.js): todas las rutas llevan la misma versión, esa versión es
// la huella del contenido actual y correr el script dos veces seguidas no cambia nada.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const DOCS = fileURLToPath(new URL("../docs/", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../herramientas/version.js", import.meta.url));
const copias = [];
after(() => copias.forEach((carpeta) => rmSync(carpeta, { recursive: true, force: true })));

/** index.html y los JS y CSS de una carpeta, por ruta. */
function leerPagina(carpeta) {
  return Object.fromEntries(
    readdirSync(carpeta, { recursive: true })
      .map((ruta) => ruta.split(sep).join("/"))
      .filter((ruta) => /\.(?:html|js|css)$/.test(ruta) && !ruta.startsWith("datos/"))
      .sort()
      .map((ruta) => [ruta, readFileSync(join(carpeta, ruta), "utf8")]),
  );
}

/** Las rutas locales de index.html (src y href a .js y .css) y de los import entre módulos, tal como están escritas. */
function rutas(pagina) {
  const encontradas = [];
  for (const [ruta, texto] of Object.entries(pagina)) {
    if (ruta === "index.html") {
      for (const [, url] of texto.matchAll(/(?:src|href)="((?!https?:|\/\/|data:)[^"]+)"/g)) {
        if (/\.(?:js|css)(?:\?|$)/.test(url)) encontradas.push(`${ruta}: ${url}`);
      }
    } else if (ruta.endsWith(".js") && !ruta.startsWith("vendor/")) {
      for (const [, url] of texto.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) {
        encontradas.push(`${ruta}: ${url}`);
      }
    }
  }
  return encontradas;
}

const versiones = (pagina) => new Set(rutas(pagina).map((r) => r.match(/\?v=([0-9a-f]{8})$/)?.[1] ?? r));

/** Una copia de docs/ sin los datos, para correr el script sin tocar el repo. */
function copiar() {
  const carpeta = mkdtempSync(join(tmpdir(), "version-"));
  copias.push(carpeta);
  cpSync(DOCS, carpeta, { recursive: true, filter: (origen) => !origen.startsWith(join(DOCS, "datos")) });
  return carpeta;
}

const correr = (carpeta) => execFileSync(process.execPath, [SCRIPT, carpeta], { encoding: "utf8" });

test("cada ruta de index.html y cada import entre módulos lleva la misma versión", () => {
  const pagina = leerPagina(DOCS);
  const todas = rutas(pagina);
  for (const esperada of ["js/tema.js", "estilos.css", "vendor/chart.umd.min.js", "js/app.js", "../config.js"]) {
    assert.ok(todas.some((r) => r.includes(`: ${esperada}?v=`)), `falta la versión en ${esperada}`);
  }
  const encontradas = versiones(pagina);
  assert.equal(encontradas.size, 1, `rutas sin versión o con versiones distintas: ${[...encontradas].join(", ")}`);
});

test("la versión es la huella del contenido: correr version.js dos veces seguidas no cambia nada", () => {
  const carpeta = copiar();
  assert.match(correr(carpeta), /sin cambios/, "falta correr node herramientas/version.js");
  assert.deepEqual(leerPagina(carpeta), leerPagina(DOCS));
  assert.match(correr(carpeta), /sin cambios/);
  assert.deepEqual(leerPagina(carpeta), leerPagina(DOCS));
});

test("si cambia un JS, un CSS o Chart.js, cambia la versión de todas las rutas y se estabiliza en una corrida", () => {
  const [antes] = versiones(leerPagina(DOCS));
  for (const archivo of ["js/formato.js", "estilos.css", "vendor/chart.umd.min.js"]) {
    const carpeta = copiar();
    appendFileSync(join(carpeta, archivo), "\n/* cambio */\n");
    assert.match(correr(carpeta), /actualicé/, archivo);
    const despues = versiones(leerPagina(carpeta));
    assert.equal(despues.size, 1, archivo);
    assert.notEqual([...despues][0], antes, archivo);
    const pagina = leerPagina(carpeta);
    assert.match(correr(carpeta), /sin cambios/, archivo);
    assert.deepEqual(leerPagina(carpeta), pagina, archivo);
  }
});

test("los fines de línea no cambian la huella", () => {
  const carpeta = copiar();
  const archivo = join(carpeta, "js", "formato.js");
  const texto = readFileSync(archivo, "utf8");
  writeFileSync(archivo, texto.includes("\r\n") ? texto.replace(/\r\n/g, "\n") : texto.replace(/\n/g, "\r\n"));
  assert.match(correr(carpeta), /sin cambios/); // si la huella cambiara, el script reescribiría las rutas
});
