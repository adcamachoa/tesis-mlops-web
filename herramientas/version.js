// Pone la versión en las rutas de los JS y CSS de la página: cada ruta local de index.html (src y href) y cada import
// entre módulos lleva ?v=<huella>, la misma en todas. Así un index.html nuevo nunca se mezcla con archivos viejos que el
// navegador tenga en caché. Se corre después de tocar cualquier JS o CSS de docs/:
//
//   node herramientas/version.js [carpeta]     (por defecto docs/)
//
// La huella son 8 caracteres del sha256 del contenido de todos los JS y CSS (Chart.js incluido, sin datos/). Se calcula
// sin los ?v= ya escritos, así que escribirla no la cambia: correr esto dos veces seguidas no cambia nada. Los fines
// de línea no cuentan, para que dé lo mismo en Windows (CRLF) y en el CI (LF). Si alguien olvida correrlo, la prueba
// pruebas/version.test.js falla.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CARPETA = resolve(process.argv[2] ?? fileURLToPath(new URL("../docs/", import.meta.url)));
// rutas locales a .js y .css; el ?v= que ya tengan se reemplaza
const EN_HTML = /((?:src|href)=")((?!https?:|\/\/|data:)[^"?#]+\.(?:js|css))(?:\?v=[0-9a-f]*)?(")/g;
const EN_JS = /((?:\bfrom|\bimport)\s*\(?\s*")(\.{1,2}\/[^"?#]+\.js)(?:\?v=[0-9a-f]*)?(")/g;

/** Los JS y CSS de la página, con su ruta dentro de la carpeta y en orden fijo. */
function archivos() {
  return readdirSync(CARPETA, { recursive: true })
    .map((ruta) => ruta.split(sep).join("/"))
    .filter((ruta) => /\.(?:js|css)$/.test(ruta) && !ruta.startsWith("datos/"))
    .sort();
}

/** Los archivos que llevan rutas versionadas: index.html y los módulos propios (Chart.js no). */
const conRutas = (ruta) => ruta === "index.html" || (ruta.endsWith(".js") && !ruta.startsWith("vendor/"));
const patron = (ruta) => (ruta.endsWith(".html") ? EN_HTML : EN_JS);
const leer = (ruta) => readFileSync(join(CARPETA, ruta), "utf8");

function huella() {
  const hash = createHash("sha256");
  for (const ruta of archivos()) {
    let texto = leer(ruta).replace(/\r\n/g, "\n");
    if (conRutas(ruta)) texto = texto.replace(patron(ruta), "$1$2$3");
    hash.update(`${ruta}\0${texto}\0`);
  }
  return hash.digest("hex").slice(0, 8);
}

const version = huella();
const cambiados = [];
for (const ruta of ["index.html", ...archivos()].filter(conRutas)) {
  const antes = leer(ruta);
  const despues = antes.replace(patron(ruta), `$1$2?v=${version}$3`);
  if (despues !== antes) {
    writeFileSync(join(CARPETA, ruta), despues);
    cambiados.push(ruta);
  }
}
console.log(`Versión ${version}: ${cambiados.length ? `actualicé ${cambiados.join(", ")}` : "sin cambios"}.`);
