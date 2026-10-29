// Pruebas de docs/config.js: el sitio publicado lee los datos de tesis-mlops y cualquier otro host, el ejemplo con su
// aviso.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DATOS, elegirDatos } from "../docs/config.js";

const DOCS = new URL("../docs/", import.meta.url);
const manifest = (pagina, datos) => new URL("manifest.json", new URL(datos.url, pagina));

test("el sitio publicado lee los datos de tesis-mlops, en su mismo dominio y sin aviso", () => {
  const pagina = "https://adcamachoa.github.io/tesis-mlops-web/";
  const datos = elegirDatos("adcamachoa.github.io");
  assert.equal(datos.sinteticos, false);
  const url = manifest(pagina, datos);
  assert.equal(url.href, "https://adcamachoa.github.io/tesis-mlops/datos/manifest.json");
  assert.equal(url.origin, new URL(pagina).origin); // connect-src 'self'
});

test("en local se usa el ejemplo sintético con su aviso", () => {
  for (const host of ["127.0.0.1", "localhost"]) {
    const datos = elegirDatos(host);
    assert.equal(datos.sinteticos, true, host);
    const url = manifest(`http://${host}:8000/`, datos);
    assert.equal(url.href, `http://${host}:8000/datos/ejemplo/manifest.json`);
    assert.ok(existsSync(fileURLToPath(new URL(url.pathname.slice(1), DOCS))), "el manifest de ejemplo existe");
  }
});

test("cualquier otro host usa el ejemplo", () => {
  for (const host of ["otro.github.io", "adcamachoa.github.io.otro.com", "sub.adcamachoa.github.io", "", undefined]) {
    assert.deepEqual(elegirDatos(host), { url: "datos/ejemplo/", sinteticos: true }, String(host));
  }
});

test("sin location, como en Node, también es el ejemplo", () => {
  assert.equal(DATOS.sinteticos, true);
});
