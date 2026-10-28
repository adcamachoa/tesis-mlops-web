# tesis-mlops-web

Página estática y pública de los pronósticos de [tesis-mlops](https://github.com/adcamachoa/tesis-mlops). El reparto entre los dos repos y el contrato de datos están en `README.md`.

## Reglas

- **Repo público y anónimo.** No pueden aparecer nombres de marcas ni de empresas en el código, los documentos, los commits ni la página. Los datos ya llegan anonimizados: submarcas en código y jerarquía con nombres genéricos.
- **Nunca piezas.** La página solo muestra el índice que trae `results.json`. No hay que reconstruir piezas ni pedir datos en piezas.
- **Sin secretos.** Este repo no tiene tokens ni acceso a Databricks. Solo lee los JSON públicos que publica `tesis-mlops`.
- **Diseño neutro.** Sin colores, logos ni estilos de ninguna empresa.
- **Cuenta personal.** Los commits y los PR van con la cuenta `adcamachoa`, nunca con una cuenta de trabajo.
- **El formato lo define `tesis-mlops`.** Está en `src/common/results_schema.py`, con su `version_esquema`. Si la página necesita un campo nuevo, se propone allá; aquí no se inventan campos. Si llega una `version_esquema` que la página no conoce, debe mostrar un mensaje claro en vez de dibujar datos mal.
- **Varios pronósticos.** La página lee `manifest.json` y no asume que hay uno solo. Un producto con marcas reales queda fuera de este repo: necesitaría inicio de sesión y otro dueño.
- **Métricas en el formato estándar:** WAPE y MAPE de mes 1, mes 2 y total, más el sesgo total.
- **Workflows, cuando existan:** nada de `pull_request_target`, acciones fijadas por commit, permisos mínimos y los mismos criterios de seguridad que `tesis-mlops`.
