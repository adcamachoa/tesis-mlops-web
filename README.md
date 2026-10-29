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

Un pronóstico. Su formato lo define `src/common/results_schema.py` en `tesis-mlops`, con su `version_esquema`. La página lee las versiones 1 y 2. Revisa lo que necesita antes de dibujar. Si llega una versión que no conoce, o un archivo que no tiene la forma esperada, muestra un mensaje claro y no dibuja nada.

**Versión 2: el árbol y las métricas por nodo.** Desde la fase 9c de `tesis-mlops`, `series` es el árbol total → submarca → departamento → categoría → serie (tipo de producto), en profundidad: cada padre antes que sus hijos.

- **`indice_minimo`** (arriba): un grupo se publica por separado si vende en promedio al menos ese índice por semana en las 52 semanas reales (0,5).
- **En cada nodo:**
  - **`id`:** la ruta en minúsculas y guiones (`submarca-a/departamento-1`), estable entre orígenes.
  - **`padre`:** el `id` del padre, o null en el total.
  - **`nivel`:** `total`, `submarca`, `departamento`, `categoria`, `serie` u `otras`.
  - **`nombre`** completo (`Submarca A | Departamento 1`) y **`etiqueta`**, el del nodo solo (`Departamento 1`).
  - **`metricas`:** el formato estándar de cada modelo en el backtest, con la venta y el pronóstico sumados al nodo, en el orden de `metricas`. No trae el mejor, el champion, el WAPE tipo × mes, el MAE ni el RMSE: esos siguen solo en la `metricas` de arriba, a nivel tipo de producto.
- **«Otras»:** junta lo de un padre que no se publica por separado: los grupos que no llegan al mínimo y, si juntos tampoco llegan, el hijo publicado más chico, aunque ese sí llegue. Si un nodo se desglosa, sus hijos lo suman, salvo el redondeo; si eso no se puede sin publicar algo bajo el mínimo, el nodo no se desglosa.

En la versión 2 la página no calcula restos entre nodos: muestra solo lo que viene publicado. Revisa además que los `id` no se repitan, que cada padre venga antes que sus hijos y un nivel arriba, y que cada nodo traiga los modelos de `metricas`.

La versión 1 trae el total, las submarcas y las 20 series de más venta, sin `id` ni `padre`: la página cuelga cada serie de la submarca que dice su nombre.

**Venta real del horizonte.** Desde la fase 9b de `tesis-mlops`, la venta real se actualiza cada semana y `results.json` trae 4 campos más. Llegaron dentro de la versión 1 y en la 2 siempre vienen, todos en el mismo índice del archivo:

- **`real_hasta`:** el último domingo con venta real. Es el mismo en todos los archivos de una corrida.
- **En cada serie:**
  - **`real_horizonte`:** 13 valores, la venta real de cada semana pronosticada. Es null hasta que la semana cierra.
  - **`ventanas_real`:** 3 valores, la venta real de cada ventana, desde la venta diaria. Es null hasta que la ventana cierra.
  - **`pronostico_anterior`:** uno por semana real. Es el pronóstico que estaba vigente en esa semana, del origen anterior más reciente que la cubría, o null si no hubo. Las semanas con valor son las mismas en todas las series.

La página revisa que cada valor esté justo en lo que cerró hasta `real_hasta`. Los archivos de la versión 1 anteriores a la 9b no traen estos campos, y con ellos la página se ve como antes. Si los campos vienen a medias, muestra un mensaje en vez de dibujar.

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

### Propuestas para una versión futura de `results.json`

Se proponen aquí y se deciden en `tesis-mlops`; la página no inventa campos. Las métricas por nivel y el padre de cada serie, que se habían propuesto aquí, llegaron en la versión 2.

- **Venta real del año anterior por ventana, exacta desde la venta diaria.** Hoy la vista por mes compara con el año anterior solo el trimestre. La venta real llega por semana y las semanas 5 y 9 se parten entre dos meses, así que por mes sería una aproximación. Con este campo la comparación sería exacta mes a mes.
  - Por ejemplo, `series[].ventanas_anio_anterior`: tres números en índice, con el mismo factor que el resto de la serie.
  - Las mismas ventanas de 31, 30 y 30 días, corridas 364 días hacia atrás (52 semanas, para que cada día caiga en el mismo día de la semana). También podría agregarse `desde` y `hasta` de cada una en `ventanas`.

## La página

Una barra bajo el encabezado, fija arriba en escritorio, tiene tres controles:

- **Segmentador de serie:** botones para el total y cada submarca y, debajo, una lista por cada nivel de la ruta elegida: departamento, categoría y tipo de producto en la versión 2, y las series de la submarca en la 1. Cada lista empieza con el nodo entero ("Toda la submarca") y deja «Otras» al final. La serie elegida filtra toda la página, salvo la comparación oficial de modelos.
  - **Al cambiar de pronóstico,** la serie se mantiene por su `id`. Si el nuevo no la publica por separado (el árbol se arma en cada origen), se muestra su grupo más cercano que sí está, con un aviso.
- **Pronóstico:** el origen que se muestra, si hay más de uno.
- **Tema:** *Sistema*, *Claro* u *Oscuro*. Por defecto sigue al sistema operativo. La elección se guarda solo en el navegador de quien la hace (`localStorage`), y `js/tema.js` la aplica antes de dibujar la página para que no parpadee.

1. **Resumen:** las cifras de la serie elegida en las 13 semanas pronosticadas (semana promedio del pronóstico, la del año anterior y la variación) y los datos de la corrida: modelo champion y versión, fecha del pronóstico, datos hasta, venta real hasta (con cuántas semanas pronosticadas ya la tienen), periodo pronosticado y backtest.
2. **Modelos en el backtest:** WAPE de mes 1, mes 2 y total, más el sesgo total. El MAPE viene en `results.json`, pero la página no lo muestra.
   - **Comparación oficial, a nivel tipo de producto:** el backtest completo, con el champion y el mejor marcados, y el complemento (WAPE tipo × mes, MAE y RMSE) en un desplegable. Con ella se elige el modelo, y no cambia con la serie.
   - **En la serie elegida** (solo en la versión 2): las mismas métricas medidas en ese nodo, con el champion marcado por su nombre y el nivel en el título. Una nota explica que el WAPE baja al subir de nivel, porque al sumar series los errores de signo contrario se compensan, así que no se compara entre niveles.
3. **Venta real y pronóstico** de la serie elegida: 52 semanas reales, 13 de pronóstico y las mismas semanas del año anterior. Abajo hay una tabla con los datos de la gráfica, en índice.
   - **Venta real después del corte:** la línea sigue hasta `real_hasta`, en las semanas pronosticadas que ya cerraron.
   - **Pronóstico anterior:** en las semanas reales, el pronóstico que estaba vigente, de un origen previo. Va con raya y punto en un azul más tenue que el del pronóstico vigente, que va a rayas. Tiene una casilla en la leyenda y se ve por defecto.
   - En la tabla de datos, las semanas pronosticadas que no han cerrado dicen "pendiente".
4. **Pronóstico por mes** de la serie elegida, contraído por defecto (se abre con un clic en el título): cada mes como semana promedio en índice (el pronóstico del periodo entre sus días, por 7) y el trimestre contra el año anterior, en %. Un texto arriba de la tabla aclara que es el pronóstico, no una métrica de error. Debajo va el desglose, y al elegir una fila toda la página pasa a esa serie.
   - **Venta real de cada mes:** debajo de cada pronóstico va la venta real del mes cuando la ventana cierra, también como semana promedio, y la diferencia en %. Mientras no cierra, dice "pendiente". El trimestre la trae cuando cierran los tres meses.
   - **Diferencia:** (pronóstico − real) / real, positiva si se pronosticó de más, como el sesgo de la tabla de modelos.
   - **Versión 2:** un nodo se desglosa en sus hijos tal como vienen, con «Otras» al final, y los hijos lo suman. Un nodo sin hijos no se desglosa; si no es un tipo de producto, una línea lo dice. Una nota explica el mínimo publicado.
   - **Versión 1:** el total se desglosa en sus submarcas, que lo suman. Una submarca se desglosa en sus series principales más "Otras series", que es la submarca menos esas series, porque `results.json` solo trae las 20 de más venta. Una serie no se desglosa.

**Exportar a Excel.** Cada tabla tiene un botón que la descarga como `.xlsx`. Las tablas son la comparación oficial de modelos, las métricas complementarias, los modelos en la serie elegida (versión 2), los datos de la gráfica y el pronóstico por mes.

- **Qué trae cada archivo:** una hoja con las mismas columnas de la página, con los números como números y su formato (índice, %, fechas), y una hoja "Notas" con la tabla, la serie, el pronóstico, la venta real hasta, la escala, el mínimo publicado (versión 2) y la fuente.
- **Venta real del horizonte:** en el pronóstico por mes, cada periodo lleva tres columnas: pronóstico, venta real y diferencia. Lo que no ha cerrado dice "pendiente".
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
  datos/ejemplo/            manifest.json y un results.json sintético por origen, en la versión 2
herramientas/
  generar_ejemplo.py        genera docs/datos/ejemplo/ y lo valida con el esquema de tesis-mlops
  servir.js                 servidor local para ver la página (npm start)
  version.js                pone la versión (?v=huella) en las rutas de los JS y CSS
pruebas/                    pruebas con node --test
  datos/v1/                 el ejemplo sintético de la versión 1, fijo: así se prueba que esa versión se sigue leyendo
.github/workflows/ci.yml    pruebas en cada PR a main
```

## Cómo probar en local

Hace falta Node 22. No hay dependencias que instalar.

```
npm test      # pruebas
npm start     # la página en http://127.0.0.1:8000
```

`npm start` es necesario porque la página lee los JSON con `fetch`, que no funciona abriendo `index.html` como archivo. En local la página muestra el ejemplo sintético con su aviso, y las pruebas también lo usan: los datos publicados solo se ven en el sitio.

Para regenerar los datos sintéticos hace falta `../tesis-mlops` con la versión 2 del esquema (fase 9c) y Python con pandas, numpy y jsonschema. Con otra copia de `tesis-mlops`, se pasa `--tesis-mlops <carpeta>`:

```
python herramientas/generar_ejemplo.py
```

El ejemplo simula la exportación del lunes 2-nov-2026, con venta real hasta el 1-nov.

- **Origen 12-oct:** 2 semanas pronosticadas con venta real, ningún mes cerrado y 4 semanas de pronóstico anterior, que viene del origen 14-sep.
- **Origen 14-sep:** 6 semanas con venta real, el mes 1 cerrado y sin pronóstico anterior.
- **El árbol** sale de `common.arbol` de `tesis-mlops`, como en la exportación, con unos 100 nodos por origen. Trae los casos que la página tiene que mostrar: un padre con «Otras», una categoría que no se desglosa y un tipo de producto nuevo que llega al mínimo el 12-oct y no el 14-sep. Las métricas por nodo son inventadas, con un WAPE que baja al subir de nivel como en dev.
- **Los `results.json` van compactos,** como los publica `tesis-mlops`.

El script valida cada `results.json` con `validar` de `tesis-mlops` antes de escribir. Además revisa que estén esos casos y que en cada desglose los hijos sumen el padre. Si algo falla, no escribe nada. De `tesis-mlops` solo lee, sin dejar `__pycache__` allá.

El ejemplo de la versión 1 quedó fijo en `pruebas/datos/v1/`, como lo generaba este script antes de la versión 2. No se regenera.

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

- **Hecho:** la página publicada muestra los pronósticos que publica `tesis-mlops`; en local, el ejemplo sintético. Lee las versiones 1 y 2 de `results.json`.
- **Siguiente:** cuando esta página esté publicada, `tesis-mlops` hace el merge de la fase 9c y empieza a publicar la versión 2.
