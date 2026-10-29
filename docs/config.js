// De dónde lee la página los datos: la carpeta que tiene manifest.json.
//
// La misma carpeta docs/ se sirve en el sitio publicado y en local, sin paso de compilación, así que se decide por el
// host. En el sitio publicado se leen los pronósticos que publica tesis-mlops; en cualquier otro (local, un fork), el
// ejemplo sintético con su aviso. La carpeta y el aviso van siempre en pareja: nunca datos reales con el aviso, ni el
// ejemplo sin él. A propósito no se puede cambiar desde la dirección de la página (ni parámetros ni #): así nadie
// comparte un enlace de esta página mostrando otros datos.
//
// Los datos publicados están en el mismo dominio, así que connect-src 'self' los permite. Si algún día la página o los
// datos cambian de dominio, hay que cambiar SITIO y, si quedan en dominios distintos, agregar el de los datos a
// connect-src en la política de seguridad de index.html.

const SITIO = "adcamachoa.github.io";
const PUBLICADOS = Object.freeze({ url: "/tesis-mlops/datos/", sinteticos: false });
const EJEMPLO = Object.freeze({ url: "datos/ejemplo/", sinteticos: true });

/** Los datos que corresponden a un host: los publicados solo en el sitio, el ejemplo en cualquier otro. */
export function elegirDatos(host) {
  return host === SITIO ? PUBLICADOS : EJEMPLO;
}

export const DATOS = elegirDatos(globalThis.location?.hostname);
