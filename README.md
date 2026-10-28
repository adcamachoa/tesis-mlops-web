# tesis-mlops-web

Página pública con los pronósticos de demanda que genera [tesis-mlops](https://github.com/adcamachoa/tesis-mlops).

## Cómo se reparten el trabajo los dos repos

| Repo | Qué hace | Secretos |
|---|---|---|
| `tesis-mlops` | Pipeline de datos y modelos. Publica los resultados como JSON en una URL pública. | Token de Databricks |
| `tesis-mlops-web` | Página estática que lee esos JSON. | Ninguno |

La página no tiene acceso a Databricks: solo lee archivos públicos. Así se puede cambiar sin tocar el pipeline, y el pipeline puede cambiar sin romperla mientras respete el formato de los datos.

## Contrato de datos

- **`results.json`:** un pronóstico. Su formato lo define `src/common/results_schema.py` en `tesis-mlops` (`version_esquema: 1`).
- **`manifest.json`:** lista los pronósticos disponibles, cada uno con la ruta de su `results.json` y su versión de esquema. La página arma el selector a partir de él. Falta implementarlo en `tesis-mlops`.
- **URL pública de los datos:** se define en la fase 9 de `tesis-mlops`.

Los datos son anónimos. La venta y el pronóstico van como índice (100 = la semana promedio del total en las 52 semanas mostradas), nunca en piezas.

## Estado

Repo recién creado. Falta elegir la estructura de la página y armarla con un `results.json` de prueba.
