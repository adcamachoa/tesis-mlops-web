# tesis-mlops-web

Página estática y pública de los pronósticos de [tesis-mlops](https://github.com/adcamachoa/tesis-mlops). El reparto entre los dos repos y el contrato de datos están en `README.md`.

## Reglas

- **Todo en español.** Las respuestas en la conversación, los commits, los PR, los documentos y los textos de la página van siempre en español.
- **Repo público y anónimo.** No pueden aparecer nombres de marcas ni de empresas en el código, los documentos, los commits ni la página. Los datos ya llegan anonimizados: submarcas en código y jerarquía con nombres genéricos.
- **Nunca piezas.** La página solo muestra el índice que trae `results.json`. No hay que reconstruir piezas ni pedir datos en piezas.
- **Sin restos en la versión 2.** En la versión 2, la página no calcula restos entre nodos: muestra solo lo que viene publicado. "Otras series", calculada, queda solo para la versión 1.
- **Sin secretos.** Este repo no tiene tokens ni acceso a Databricks. Solo lee los JSON públicos que publica `tesis-mlops`.
- **Diseño neutro.** Sin colores, logos ni estilos de ninguna empresa.
- **Cuenta personal.** Los commits y los PR van con la cuenta `adcamachoa`, nunca con una cuenta de trabajo.
- **El formato lo define `tesis-mlops`.** Está en `src/common/results_schema.py`, con su `version_esquema`. Si la página necesita un campo nuevo, se propone allá; aquí no se inventan campos. Si llega una `version_esquema` que la página no conoce, debe mostrar un mensaje claro en vez de dibujar datos mal.
- **Qué datos lee la página.** Lo decide `docs/config.js` por el host: en `adcamachoa.github.io`, los que publica `tesis-mlops` en `/tesis-mlops/datos/`; en cualquier otro (local, forks), el ejemplo sintético con su aviso. La carpeta y el aviso van siempre en pareja, y nunca se eligen desde la dirección de la página (ni parámetros ni `#`).
- **Varios pronósticos.** La página lee `manifest.json` y no asume que hay uno solo. Un producto con marcas reales queda fuera de este repo: necesitaría inicio de sesión y otro dueño.
- **Métricas en la página:** WAPE de mes 1, mes 2 y total, más el sesgo total. El MAPE viene en `results.json`, pero la página no lo muestra ni lo exporta (decisión del 28-oct-2026).
- **Workflows:** nada de `pull_request_target`, acciones fijadas por commit, permisos mínimos y los mismos criterios de seguridad que `tesis-mlops`. Hoy solo existe `ci.yml` (pruebas en cada PR); la página se publica desde `main` `/docs`, sin workflow de despliegue.
- **Datos de ejemplo solo sintéticos.** Se generan con `herramientas/generar_ejemplo.py`, que los valida con el esquema de `tesis-mlops`; no se editan a mano. El de la versión 1 quedó fijo en `pruebas/datos/v1/` y no se regenera. De `tesis-mlops` solo se lee: nunca se edita desde aquí.
- **Nada de datos reales ni MLflow desde aquí.** Este repo trabaja solo con datos sintéticos y con lo que publica `tesis-mlops`. Los análisis con datos reales, con Databricks o con MLflow se hacen en `tesis-mlops`, y nada de eso se descarga en este repo ni en carpetas temporales de sus sesiones.
- **Sin dependencias.** HTML, CSS y JavaScript sin compilar. Chart.js va en `docs/vendor/` con versión fija y su licencia; las pruebas usan `node --test`. Los `.xlsx` se escriben con `docs/js/xlsx.js`, sin librería.
- **El texto de los datos nunca entra como HTML.** Se usa `textContent` o `append` con strings, nunca `innerHTML`. La política de seguridad de `index.html` solo deja cargar scripts y datos del propio sitio.

## Comandos

- `npm test`: pruebas de `docs/js/` con el ejemplo sintético.
- `npm start`: sirve `docs/` en http://127.0.0.1:8000 para verla en local, con el ejemplo sintético.
- `node herramientas/version.js`: pone la versión (`?v=<huella>`) en las rutas de los JS y CSS. Hay que correrlo después de tocar cualquier JS o CSS de `docs/`; si no, `npm test` y el CI fallan.
- `python herramientas/generar_ejemplo.py`: regenera `docs/datos/ejemplo/` en la versión 2 (necesita `../tesis-mlops` con la fase 9c, pandas, numpy y jsonschema).
