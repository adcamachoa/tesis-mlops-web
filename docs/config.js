// De dónde lee la página los datos: la carpeta que tiene manifest.json.
//
// Mientras tesis-mlops no publique sus pronósticos, la página usa el ejemplo sintético y lo avisa. Cuando los publique,
// `url` pasa a ser su carpeta pública y `sinteticos` a false. Si esa carpeta está en otro dominio, hay que agregarlo a
// connect-src en la política de seguridad de index.html. A propósito no se puede cambiar desde la dirección de la página:
// así nadie comparte un enlace de esta página mostrando otros datos.
export const DATOS = {
  url: "datos/ejemplo/",
  sinteticos: true,
};
