// Sirve docs/ en http://127.0.0.1:8000 para ver la página en local: npm start (o node herramientas/servir.js [puerto]).
// La página lee los JSON con fetch, que no funciona abriendo index.html como archivo. Solo escucha en este equipo y
// solo entrega archivos de docs/.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CARPETA = resolve(fileURLToPath(new URL("../docs/", import.meta.url)));
const PUERTO = Number(process.argv[2] ?? 8000);
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

createServer(async (pedido, respuesta) => {
  const ruta = decodeURIComponent(new URL(pedido.url, "http://localhost").pathname);
  const archivo = resolve(join(CARPETA, ruta.endsWith("/") ? `${ruta}index.html` : ruta));
  if (!archivo.startsWith(CARPETA + sep)) {
    respuesta.writeHead(403).end();
    return;
  }
  try {
    const cuerpo = await readFile(archivo);
    respuesta.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    respuesta.end(cuerpo);
  } catch {
    respuesta.writeHead(404).end();
  }
}).listen(PUERTO, "127.0.0.1", () => console.log(`Página en http://127.0.0.1:${PUERTO}/`));
