# tesis-mlops-web

Página pública con los pronósticos de demanda que genera [tesis-mlops](https://github.com/adcamachoa/tesis-mlops).

## Cómo se reparten el trabajo los dos repos

| Repo | Qué hace | Secretos |
|---|---|---|
| `tesis-mlops` | Pipeline de datos y modelos. Publica los resultados como JSON en una URL pública. | Token de Databricks |
| `tesis-mlops-web` | Página estática que lee esos JSON. | Ninguno |

La página no tiene acceso a Databricks: solo lee archivos públicos. Así se puede cambiar sin tocar el pipeline, y el pipeline puede cambiar sin romperla mientras respete el formato de los datos. Los datos se leen al abrir la página: un pronóstico nuevo aparece sin volver a publicarla.

## Contrato de datos

Los datos son anónimos. La venta y el pronóstico van como índice (100 = la semana promedio del total en las 52 semanas mostradas), nunca en piezas.

### `results.json`

Un pronóstico. Su formato lo define `src/common/results_schema.py` en `tesis-mlops` (`version_esquema: 1`). La página revisa lo que necesita antes de dibujar. Si llega una versión que no conoce, o un archivo que no tiene la forma esperada, muestra un mensaje claro y no dibuja nada.

### `manifest.json`

Lista los pronósticos disponibles. La página arma el selector a partir de él. Formato versión 1, implementado en `tesis-mlops`:

```json
{
  "version_manifest": 1,
  "generado": "2026-10-28T17:05:00",
  "pronosticos": [
    {
      "id": "2026-10-12",
      "ruta": "2026-10-12/results.json",
      "version_esquema": 1,
      "origen": "2026-10-12",
      "fecha_prediccion": "2026-10-28T16:28:09"
    }
  ]
}
```

- **Una entrada por origen.** Si un origen se corre dos veces, el manifest trae solo la última corrida, igual que `export_results.py`: la última corrida del origen. Su `results.json` reemplaza al anterior.
- **`version_manifest`:** la versión de este archivo, aparte de la de `results.json`. Si la página no la conoce, muestra un mensaje en vez del selector.
- **`id`:** único, solo minúsculas, números y guiones. Va en la dirección de la página (`…/#2026-10-12`) para compartir el enlace a un pronóstico.
- **`ruta`:** relativa al manifest, sin `..`, `/` inicial ni `http`. La página solo lee archivos de la carpeta del manifest.
- **`version_esquema`:** la versión de ese `results.json`. Si la página no la conoce, la opción aparece deshabilitada y no se descarga.
- **`origen` y `fecha_prediccion`:** los mismos de `corrida` en el `results.json`. Sirven para ordenar y nombrar el selector sin descargar todos los archivos. Si no coinciden con los del archivo, la página no lo muestra.
- **Sin texto libre.** La etiqueta del selector se arma con las fechas. Si algún día hay más de un producto, se agrega en `version_manifest: 2`.
- **Orden.** La página ordena del origen más reciente al más antiguo y abre el primero, salvo que el enlace pida otro.

### URL pública de los datos

`tesis-mlops` publica `manifest.json` y los `results.json` en el GitHub Pages de ese repo: <https://adcamachoa.github.io/tesis-mlops/datos/>. Esta página queda en <https://adcamachoa.github.io/tesis-mlops-web/>: el mismo dominio, así que la política de seguridad (`connect-src 'self'`) deja leer los datos sin configuración extra.

`docs/config.js` elige los datos según el host, porque la misma carpeta `docs/` se sirve publicada y en local sin paso de compilación:

- **En `adcamachoa.github.io`:** los datos publicados (`/tesis-mlops/datos/`), sin aviso.
- **En cualquier otro host** (local, un fork): el ejemplo sintético (`datos/ejemplo/`), con su aviso.

La carpeta y el aviso van siempre en pareja. Los datos no se pueden cambiar desde la dirección de la página: ni parámetros ni `#`. Si la página o los datos cambian de dominio, se cambia `docs/config.js` y, si quedan en dominios distintos, se agrega el de los datos a `connect-src` en `docs/index.html`.

GitHub Pages guarda los archivos en caché hasta 10 minutos, así que un pronóstico nuevo puede tardar ese tiempo en aparecer.

### Propuestas para la versión 2 de `results.json`

Se proponen aquí y se deciden en `tesis-mlops`; la página no inventa campos.

- **Venta real del año anterior por ventana, exacta desde la venta diaria.** Hoy la vista por mes compara con el año anterior solo el trimestre. La venta real llega por semana y las semanas 5 y 9 se parten entre dos meses, así que por mes sería una aproximación. Con este campo la comparación sería exacta mes a mes.
  - Por ejemplo, `series[].ventanas_anio_anterior`: tres números en índice, con el mismo factor que el resto de la serie.
  - Las mismas ventanas de 31, 30 y 30 días, corridas 364 días hacia atrás (52 semanas, para que cada día caiga en el mismo día de la semana). También podría agregarse `desde` y `hasta` de cada una en `ventanas`.
- **Métricas por nivel: total, submarca y serie.** Hoy `metricas` es solo del backtest completo a nivel tipo de producto, así que la tabla de modelos no cambia con la serie elegida y lo dice.
  - Por ejemplo, `series[].metricas`: el formato estándar de cada modelo para esa serie, con la misma forma que `metricas`.
  - Con eso, la tabla seguiría al selector. La página explicaría además que el WAPE baja al subir de nivel: al sumar series, los errores de signo contrario se compensan, así que el total tiene menos error que una submarca, y una submarca menos que sus series.
- **La submarca de cada serie como campo.** Hoy la página la lee del nombre (`Submarca A | Departamento 1 | …`) para desglosar cada submarca en sus series. Si un nombre no tiene esa forma, la submarca simplemente no se desglosa.
  - Por ejemplo, `series[].submarca`: el nombre de la submarca en las series de nivel `serie`, y null en el total y las submarcas.
  - Así la página no depende del formato del nombre.

## La página

Una barra bajo el encabezado, fija arriba en escritorio, tiene tres controles:

- **Segmentador de serie:** botones para el total y cada submarca y, al elegir una submarca, una lista con sus series. La serie elegida filtra toda la página, salvo la tabla de modelos.
- **Pronóstico:** el origen que se muestra, si hay más de uno.
- **Tema:** *Sistema*, *Claro* u *Oscuro*. Por defecto sigue al sistema operativo. La elección se guarda solo en el navegador de quien la hace (`localStorage`), y `js/tema.js` la aplica antes de dibujar la página para que no parpadee.

1. **Resumen:** las cifras de la serie elegida en las 13 semanas pronosticadas (semana promedio del pronóstico, la del año anterior y la variación) y los datos de la corrida: modelo champion y versión, fecha del pronóstico, datos hasta, periodo pronosticado y backtest.
2. **Modelos en el backtest:** WAPE de mes 1, mes 2 y total, más el sesgo total, con el champion y el mejor marcados. El complemento (WAPE tipo × mes, MAE y RMSE) va en un desplegable. Son las métricas del backtest completo a nivel tipo de producto y no cambian con la serie. El MAPE viene en `results.json`, pero la página no lo muestra.
3. **Venta real y pronóstico** de la serie elegida: 52 semanas reales, 13 de pronóstico y las mismas semanas del año anterior. Abajo hay una tabla con los datos de la gráfica, en índice.
4. **Pronóstico por mes** de la serie elegida, contraído por defecto (se abre con un clic en el título): cada mes como semana promedio en índice (el pronóstico del periodo entre sus días, por 7) y el trimestre contra el año anterior, en %. Un texto arriba de la tabla aclara que es el pronóstico, no una métrica de error. Debajo va el desglose, y al elegir una fila toda la página pasa a esa serie.
   - **Total:** se desglosa en sus submarcas, que lo suman.
   - **Submarca:** se desglosa en sus series principales más "Otras series", que es la submarca menos esas series, porque `results.json` solo trae las 20 de más venta.
   - **Serie:** no se desglosa.

**Exportar a Excel.** Cada tabla tiene un botón que la descarga como `.xlsx`. Las tablas son modelos, métricas complementarias, datos de la gráfica y pronóstico por mes.

- **Qué trae cada archivo:** una hoja con las mismas columnas de la página, con los números como números y su formato (índice, %, fechas), y una hoja "Notas" con la tabla, la serie, el pronóstico, la escala y la fuente.
- **Serie elegida:** las tablas de la gráfica y del pronóstico por mes salen de la serie elegida.
- **Sin dependencias:** el archivo se arma en el navegador con `js/xlsx.js`.

Con el ejemplo (en local o en cualquier sitio que no sea el publicado), la página muestra un aviso de datos sintéticos, y los archivos exportados lo repiten en sus notas.

## Estructura

```
docs/                       lo que publica GitHub Pages (main, carpeta /docs)
  index.html  estilos.css  .nojekyll
  config.js                 de dónde lee los datos: publicados en el sitio, el ejemplo en cualquier otro host
  js/datos.js               lee y revisa manifest y results; cálculos (sin DOM, con pruebas)
  js/formato.js             números, porcentajes y fechas en español
  js/secciones.js           resumen, tablas y mensajes de error
  js/grafica.js             la gráfica con Chart.js
  js/app.js                 arranque, segmentador, selector de pronóstico y tema
  js/tema.js                aplica el tema guardado antes de dibujar la página
  js/exportar.js            arma cada tabla para Excel (sin DOM, con pruebas)
  js/xlsx.js                escribe el .xlsx: un ZIP con las hojas XML (sin DOM, con pruebas)
  vendor/                   Chart.js 4.5.1 y su licencia
  datos/ejemplo/            manifest.json y un results.json sintético por origen
herramientas/
  generar_ejemplo.py        genera docs/datos/ejemplo/ y lo valida con el esquema de tesis-mlops
  servir.js                 servidor local para ver la página (npm start)
  version.js                pone la versión (?v=huella) en las rutas de los JS y CSS
pruebas/                    pruebas con node --test
.github/workflows/ci.yml    pruebas en cada PR a main
```

## Cómo probar en local

Hace falta Node 22. No hay dependencias que instalar.

```
npm test      # pruebas
npm start     # la página en http://127.0.0.1:8000
```

`npm start` es necesario porque la página lee los JSON con `fetch`, que no funciona abriendo `index.html` como archivo. En local la página muestra el ejemplo sintético con su aviso, y las pruebas también lo usan: los datos publicados solo se ven en el sitio.

Para regenerar los datos sintéticos hace falta `../tesis-mlops` y Python con pandas, numpy y jsonschema:

```
python herramientas/generar_ejemplo.py
```

El script valida cada `results.json` con `validar` de `tesis-mlops` antes de escribir. Si alguno no cumple el esquema, no escribe nada. De `tesis-mlops` solo lee, sin dejar `__pycache__` allá.

## Publicación

- **GitHub Pages** publica `main`, carpeta `/docs`, en <https://adcamachoa.github.io/tesis-mlops-web/>. Se configuró a mano (Settings → Pages → Deploy from a branch); no hay workflow de despliegue.
- **CI** (`.github/workflows/ci.yml`) corre `node --test` en cada PR a `main`. Usa `pull_request` y nunca `pull_request_target`, tiene permisos de solo lectura, no usa secretos y fija sus acciones por commit.
- **Ruleset en `main`:** todo cambio entra por PR con el check `pruebas` en verde; no se puede borrar la rama ni forzar el push, y nadie se lo salta.
- **Versión de los archivos.** Cada ruta de `index.html` a un JS o CSS (Chart.js incluido) y cada `import` entre módulos lleva `?v=<huella>`, la misma en todas. Así, después de publicar, el navegador no mezcla un archivo viejo de su caché con los nuevos.
  - **Cuándo correrlo:** después de tocar cualquier JS o CSS de `docs/`, corre `node herramientas/version.js`. Si se olvida, las pruebas fallan.
  - **La huella:** son 8 caracteres del sha256 del contenido de todos los JS y CSS. No cuenta los `?v=` ya escritos ni los fines de línea, así que correr el script dos veces seguidas no cambia nada.
  - **El límite:** GitHub Pages guarda el `index.html` en caché hasta 10 minutos. En ese rato alguien puede seguir viendo la versión anterior completa, sin mezclas.

## Dependencias

- **Chart.js 4.5.1**, licencia MIT (`docs/vendor/chart.js-LICENSE.md`).
  - Se bajó del registro de npm y se verificó contra el hash `sha512` que publica npm.
  - Se eligió 4.5.1 y no 4.6.1 porque esta última salió el 22-oct-2026, hace muy poco.
  - Para actualizarla, se repite lo mismo con la nueva versión y se revisa la página en claro, oscuro y celular.

## Estado

- **Hecho:** la página publicada muestra los pronósticos que publica `tesis-mlops`; en local, el ejemplo sintético.
- **Siguiente:** la versión 2 de `results.json`, que se define en `tesis-mlops` (ver las propuestas arriba).
