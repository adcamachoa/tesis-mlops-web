// Auxiliar de las pruebas: lee un ZIP sin compresión, como los .xlsx de docs/js/xlsx.js, y revisa sus firmas y CRC.
import assert from "node:assert/strict";

import { crc32 } from "../docs/js/xlsx.js";

const leerTexto = new TextDecoder();

/** Los archivos del ZIP como texto, por nombre, leídos desde el directorio central. */
export function leerZip(bytes) {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fin = bytes.length - 22;
  assert.equal(vista.getUint32(fin, true), 0x06054b50, "falta el fin del directorio central");
  const archivos = {};
  let p = vista.getUint32(fin + 16, true);
  for (let i = 0; i < vista.getUint16(fin + 10, true); i++) {
    assert.equal(vista.getUint32(p, true), 0x02014b50, "entrada del directorio central");
    const largoNombre = vista.getUint16(p + 28, true);
    const nombre = leerTexto.decode(bytes.subarray(p + 46, p + 46 + largoNombre));
    const local = vista.getUint32(p + 42, true);
    assert.equal(vista.getUint32(local, true), 0x04034b50, `encabezado local de ${nombre}`);
    const inicio = local + 30 + vista.getUint16(local + 26, true);
    const contenido = bytes.subarray(inicio, inicio + vista.getUint32(p + 20, true));
    assert.equal(crc32(contenido), vista.getUint32(p + 16, true), `CRC de ${nombre}`);
    archivos[nombre] = leerTexto.decode(contenido);
    p += 46 + largoNombre;
  }
  return archivos;
}
