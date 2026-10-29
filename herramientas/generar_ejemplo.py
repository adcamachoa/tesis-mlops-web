"""Genera los datos sintéticos de la página: un results.json por origen y el manifest.json que los lista, en la versión
2 del esquema: el árbol total → submarca → departamento → categoría → tipo de producto, con las métricas del backtest
en cada nodo.

Los números son inventados con una semilla fija; no salen de ningún dato real. El árbol se arma con common.arbol de
tesis-mlops, como en export_results.py, y cada results.json se valida con su esquema (src/common/results_schema.py)
antes de escribir. También se revisa que el ejemplo traiga los casos que la página tiene que mostrar y que en cada
desglose los hijos sumen el padre. Si algo falla, no se escribe nada. De tesis-mlops solo se lee: se importa sin dejar
__pycache__ allá.

El ejemplo de la versión 1 quedó fijo en pruebas/datos/v1/ para las pruebas; este script ya no lo genera.

    python herramientas/generar_ejemplo.py
    python herramientas/generar_ejemplo.py --tesis-mlops ../tesis-mlops --salida docs/datos/ejemplo
"""
import argparse
import json
import math
import random
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from types import SimpleNamespace

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
SEMILLA = 2026
ORIGENES = (date(2026, 9, 14), date(2026, 10, 12))  # lunes de la última semana con venta real de cada pronóstico
# el último domingo con venta real, el mismo en todos los archivos, como en la exportación semanal: 2 semanas después
# del origen más reciente, para probar el caso a mitad del horizonte. El del 14-sep ya tiene su mes 1 cerrado.
REAL_HASTA = ORIGENES[-1] + timedelta(days=6 + 14)
GENERADO = datetime.combine(REAL_HASTA + timedelta(days=1), time(10, 0))  # el lunes siguiente, cuando se exporta
SEMANAS_REALES = 52
SERIES_POR_SUBMARCA = 20
SUBMARCAS = {"Submarca A": 1.0, "Submarca B": 0.6, "Submarca C": 0.35}  # tamaño relativo
TENDENCIA = {"Submarca A": -0.06, "Submarca B": 0.04, "Submarca C": 0.0}  # cambio por año
PICOS = {(11, 20): 2.4, (5, 28): 1.8}  # (mes, día): la semana que contiene esa fecha vende tantas veces más
RUIDO_REAL = 0.12
RUIDO_PRONOSTICO = 0.05
SESGO_PRONOSTICO = {ORIGENES[0]: 1.02, ORIGENES[1]: 0.94}
DECIMALES_INDICE = 1
DECIMALES_METRICA = 4
REDONDEO = 0.05  # lo que puede moverse un valor al redondearlo a 1 decimal

# Dos categorías hechas a mano, con el índice promedio semanal de cada tipo. En la primera, cuatro tipos quedan bajo el
# mínimo y juntos lo pasan, así que van en «Otras». En la segunda, el último tipo empieza a vender LANZAMIENTO semanas
# antes del último origen: el 12-oct llega al mínimo y el 14-sep no, así que solo está en uno de los dos árboles.
CON_OTRAS = ("Submarca B | Departamento 3 | Categoría 3.5", (1.5, 0.22, 0.22, 0.22, 0.22))
CON_LANZAMIENTO = ("Submarca A | Departamento 2 | Categoría 2.5", (2.0, 1.2, 4.5))
LANZAMIENTO = 8

# WAPE tipo × mes inventado de cada modelo en el backtest de cada origen. En el último origen el mejor no es el
# champion, para que la página muestre ese caso.
WAPE_TIPO_MES = {
    ORIGENES[0]: {"produccion": 0.402, "lightgbm_tweedie_211": 0.411, "lightgbm_tweedie": 0.428,
                  "random_forest": 0.497, "media_movil_8": 0.634, "naive_estacional": 0.781},
    ORIGENES[1]: {"lightgbm_tweedie_211": 0.395, "produccion": 0.398, "lightgbm_tweedie": 0.421,
                  "random_forest": 0.488, "media_movil_8": 0.627, "naive_estacional": 0.774},
}
CHAMPION = {ORIGENES[0]: ("produccion", 2), ORIGENES[1]: ("produccion", 3)}
SIN_MAPE = ("naive_estacional", "mape_m2")  # una métrica vacía, para probar cómo la muestra la página
# el WAPE de cada nivel contra el de un tipo de producto: al sumar series, los errores de signo contrario se compensan.
# Son las medianas del champion en dev (fase 9c de PLAN.md en tesis-mlops): 31,3 % por serie y 14,7 % en el total.
WAPE_NIVEL = {"total": 0.47, "submarca": 0.54, "departamento": 0.68, "categoria": 0.82, "serie": 1.0}
DISPERSION_NIVEL = {"total": 0.03, "submarca": 0.08, "departamento": 0.12, "categoria": 0.18, "serie": 0.25}


def cargar_tesis_mlops(ruta: Path) -> SimpleNamespace:
    """El esquema, el árbol y las constantes de results.json, importados de tesis-mlops solo para leer."""
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(ruta / "src"))
    from common import arbol, results_schema
    from common.features import HORIZONTE, SERIE
    from common.metrics import METRICAS, VENTANAS_DIAS

    return SimpleNamespace(esquema=results_schema, arbol=arbol, horizonte=HORIZONTE, metricas=METRICAS,
                           ventanas_dias=VENTANAS_DIAS, columnas=SERIE)


def definir_series(base: float) -> list[dict]:
    """Las series inventadas: 20 por submarca, cada una con su tamaño y su temporada, más las de CON_OTRAS y
    CON_LANZAMIENTO, con su tamaño en índice (`base` es el índice de una semana promedio del total)."""
    azar = random.Random(SEMILLA)
    series = []

    def agregar(nombre: str, nivel: float, desde: date | None = None):
        series.append({"nombre": nombre, "submarca": nombre.split(" | ")[0], "nivel": nivel, "desde": desde,
                       "amplitud": azar.uniform(0.1, 0.35), "fase": azar.uniform(-20, 20)})

    for submarca, tamano in SUBMARCAS.items():
        for i in range(SERIES_POR_SUBMARCA):
            departamento = i % 3 + 1
            agregar(f"{submarca} | Departamento {departamento} | Categoría {departamento}.{i % 4 + 1} "
                    f"| Tipo {len(series) + 1}", 40 * tamano * azar.lognormvariate(0, 0.9))
    unidad = sum(s["nivel"] for s in series) / base  # lo que vale 1 de índice, más o menos
    lanzamiento = ORIGENES[-1] - timedelta(weeks=LANZAMIENTO - 1)
    for categoria, indices in (CON_OTRAS, CON_LANZAMIENTO):
        for i, indice in enumerate(indices):
            desde = lanzamiento if (categoria, i) == (CON_LANZAMIENTO[0], len(indices) - 1) else None
            agregar(f"{categoria} | Tipo {len(series) + 1}", indice * unidad, desde)
    return series


def calendario(lunes: date) -> float:
    """Cuánto más (o menos) vende la semana que empieza `lunes` por los picos y las fiestas inventadas."""
    for (mes, dia), alto in PICOS.items():
        pico = date(lunes.year, mes, dia)
        if lunes <= pico <= lunes + timedelta(days=6):
            return alto
        if lunes - timedelta(days=7) <= pico < lunes:
            return 1 + (alto - 1) / 3  # la semana siguiente todavía arrastra algo
    if lunes.month == 12 and lunes.day <= 24:
        return 1.3
    if lunes.month == 1 and lunes.day <= 14:
        return 0.8
    return 1.0


def patron(serie: dict, lunes: date) -> float:
    """Venta esperada de la serie en la semana que empieza `lunes`, en unidades inventadas y sin ruido."""
    if serie["desde"] and lunes < serie["desde"]:
        return 0.0
    dia = lunes.timetuple().tm_yday
    temporada = 1 + serie["amplitud"] * math.sin(2 * math.pi * (dia - 80 + serie["fase"]) / 365.25)
    tendencia = 1 + TENDENCIA[serie["submarca"]] * (lunes - ORIGENES[-1]).days / 365.25
    return serie["nivel"] * temporada * tendencia * calendario(lunes)


def ruido(sigma: float, *clave) -> float:
    """Un factor de ruido que depende solo de `clave`: la misma semana vale igual en todos los pronósticos."""
    return math.exp(random.Random("|".join(map(str, (SEMILLA, *clave)))).gauss(0, sigma))


def venta_real(serie: dict, lunes: date) -> float:
    return patron(serie, lunes) * ruido(RUIDO_REAL, serie["nombre"], lunes)


def pronostico(serie: dict, origen: date, h: int) -> float:
    lunes = origen + timedelta(weeks=h)
    return patron(serie, lunes) * SESGO_PRONOSTICO[origen] * ruido(RUIDO_PRONOSTICO, serie["nombre"], origen, h)


def pronostico_vigente(serie: dict, origen: date, lunes: date, horizonte: int) -> float | None:
    """El pronóstico que estaba vigente para la semana `lunes`: el del origen anterior a `origen` más reciente cuyo
    horizonte la cubre, como en export_results.py. None si ninguno la cubría."""
    for anterior in sorted((o for o in ORIGENES if o < origen), reverse=True):
        h = (lunes - anterior).days // 7
        if 1 <= h <= horizonte:
            return pronostico(serie, anterior, h)
    return None


def por_ventana(semanal: list[float], ventanas_dias) -> list[float]:
    """Reparte la venta o el pronóstico de cada semana entre las ventanas, 1/7 por día."""
    ventana_del_dia = [v for v, dias in enumerate(ventanas_dias) for _ in range(dias)]
    total = [0.0] * len(ventanas_dias)
    for dia, ventana in enumerate(ventana_del_dia):
        total[ventana] += semanal[dia // 7] / 7
    return total


def metricas(origen: date, tm: SimpleNamespace, celda_promedio: float) -> list[dict]:
    """La tabla de modelos inventada, en el orden de export_results.py: de menor a mayor WAPE tipo × mes."""
    azar = random.Random(f"{SEMILLA}|metricas|{origen}")
    campeon = CHAMPION[origen][0]
    filas = []
    for modelo, base in sorted(WAPE_TIPO_MES[origen].items(), key=lambda par: par[1]):
        wape = {"m1": base * azar.uniform(0.83, 0.88), "m2": base * azar.uniform(1.05, 1.12),
                "total": base * azar.uniform(0.86, 0.91)}
        mae = base * celda_promedio * azar.uniform(0.95, 1.05)
        valores = {
            **{f"wape_{n}": v for n, v in wape.items()},
            **{f"mape_{n}": v * azar.uniform(1.3, 1.6) for n, v in wape.items()},
            "sesgo_total": azar.uniform(-0.08, 0.1),
            "wape_tipo_mes": base,
            "mae": mae,
            "rmse": mae * azar.uniform(1.8, 2.4),
        }
        if modelo == SIN_MAPE[0]:
            valores[SIN_MAPE[1]] = None
        filas.append(
            {
                "modelo": modelo,
                **{m: None if valores[m] is None else round(valores[m], DECIMALES_METRICA) for m in tm.metricas},
                "es_mejor": not filas,
                "es_champion": modelo == campeon,
            }
        )
    return filas


def metricas_nodo(nodo, nivel: str, raiz: list[dict], origen: date, tm: SimpleNamespace) -> list[dict]:
    """Las métricas inventadas de un nodo, en el orden de la raíz: el WAPE de cada modelo baja al subir de nivel
    (WAPE_NIVEL) y varía más en los nodos chicos; el sesgo, como en la raíz, más una variación del nodo."""
    azar = random.Random(f"{SEMILLA}|nodo|{origen}|{nodo.id}")
    dispersion = DISPERSION_NIVEL[nivel]
    escala = WAPE_NIVEL[nivel] * azar.lognormvariate(0, dispersion)
    sesgo = azar.gauss(0, dispersion / 2)
    filas = []
    for fila in raiz:
        wape = {n: fila[f"wape_{n}"] * escala * azar.lognormvariate(0, 0.05) for n in ("m1", "m2", "total")}
        valores = {
            **{f"wape_{n}": v for n, v in wape.items()},
            **{f"mape_{n}": v * azar.uniform(1.3, 1.6) for n, v in wape.items()},
            "sesgo_total": fila["sesgo_total"] + sesgo + azar.gauss(0, 0.01),
        }
        redondeados = {m: round(valores[m], DECIMALES_METRICA) for m in tm.esquema.METRICAS_NODO}
        filas.append({"modelo": fila["modelo"], **redondeados})
    return filas


def construir_resultados(origen: date, series: list[dict], tm: SimpleNamespace) -> dict:
    """Un results.json sintético con la forma que arma export_results.py en tesis-mlops.

    El árbol sale de common.arbol con el peso de cada serie en este origen (su índice promedio semanal de venta real en
    las 52 semanas), así que se rearma en cada origen. Todo va en el índice de este archivo, también el pronóstico
    anterior, que sale del pronóstico de otro origen: la página nunca compara valores entre archivos. Después del
    origen solo hay venta real en las semanas y las ventanas que cerraron hasta REAL_HASTA; la de cada ventana sale de
    repartir cada semana 1/7 por día."""
    semanas = [origen - timedelta(weeks=SEMANAS_REALES - 1 - i) for i in range(SEMANAS_REALES)]
    horizonte = range(1, tm.horizonte + 1)
    semanas_pronostico = [origen + timedelta(weeks=h) for h in horizonte]
    real = {s["nombre"]: [venta_real(s, lunes) for lunes in semanas] for s in series}
    semanal = {s["nombre"]: [pronostico(s, origen, h) for h in horizonte] for s in series}
    ventanas = {nombre: por_ventana(valores, tm.ventanas_dias) for nombre, valores in semanal.items()}
    real_horizonte = {s["nombre"]: [venta_real(s, lunes) for lunes in semanas_pronostico] for s in series}
    ventanas_real = {nombre: por_ventana(valores, tm.ventanas_dias) for nombre, valores in real_horizonte.items()}
    vigente = {s["nombre"]: [pronostico_vigente(s, origen, lunes, tm.horizonte) for lunes in semanas] for s in series}
    factor = tm.esquema.BASE_INDICE * SEMANAS_REALES / sum(map(sum, real.values()))

    catalogo = pd.DataFrame([[s["nombre"], *s["nombre"].split(" | ")] for s in series], columns=["serie", *tm.columnas])
    pesos = pd.Series({nombre: sum(valores) * factor / SEMANAS_REALES for nombre, valores in real.items()})
    nodos = tm.arbol.construir(catalogo, pesos)
    nivel_de = {nodo.id: nodo.nivel for nodo in nodos}

    lunes = origen + timedelta(weeks=1)
    fines = [sum(tm.ventanas_dias[: i + 1]) for i in range(len(tm.ventanas_dias))]
    hasta_ventanas = [lunes + timedelta(days=fin - 1) for fin in fines]
    # qué se conoce: las semanas y ventanas cerradas hasta REAL_HASTA, y las semanas que cubría un pronóstico anterior
    cerradas = [semana + timedelta(days=6) <= REAL_HASTA for semana in semanas_pronostico]
    ventanas_cerradas = [hasta <= REAL_HASTA for hasta in hasta_ventanas]
    cubiertas = [valor is not None for valor in next(iter(vigente.values()))]
    dia_corrida = origen + timedelta(days=16)
    total_ventanas = sum(sum(v) for v in ventanas.values()) * factor
    raiz = metricas(origen, tm, total_ventanas / (len(series) * len(tm.ventanas_dias)))

    def serie(nodo) -> dict:
        def suma(tabla: dict, conocidas: list[bool] | None = None) -> list[float | None]:
            """Con `conocidas`, null donde el valor todavía no se conoce."""
            columnas = zip(*(tabla[m] for m in sorted(nodo.series)))
            valores = [round(sum(v or 0 for v in c) * factor, DECIMALES_INDICE) for c in columnas]
            if conocidas is None:
                return valores
            return [v if conocida else None for v, conocida in zip(valores, conocidas, strict=True)]

        nivel = nodo.nivel
        if nivel == tm.arbol.OTRAS:  # se mide como sus hermanos, un nivel debajo de su padre
            nivel = tm.arbol.NIVELES[tm.arbol.NIVELES.index(nivel_de[nodo.padre]) + 1]
        return {"id": nodo.id, "padre": nodo.padre, "nivel": nodo.nivel, "nombre": nodo.nombre,
                "etiqueta": nodo.etiqueta, "real": suma(real), "pronostico": suma(semanal), "ventanas": suma(ventanas),
                "real_horizonte": suma(real_horizonte, cerradas), "pronostico_anterior": suma(vigente, cubiertas),
                "ventanas_real": suma(ventanas_real, ventanas_cerradas),
                "metricas": metricas_nodo(nodo, nivel, raiz, origen, tm)}

    champion, version = CHAMPION[origen]
    return {
        "version_esquema": tm.esquema.VERSION,
        "generado": GENERADO.isoformat(),
        "escala": tm.esquema.ESCALA,
        "indice_minimo": tm.arbol.INDICE_MINIMO,
        "real_hasta": REAL_HASTA.isoformat(),
        "corrida": {
            "fecha_prediccion": datetime.combine(dia_corrida, time(9, 30)).isoformat(),
            "fecha_entrenamiento": datetime.combine(dia_corrida, time(8, 10)).isoformat(),
            "origen": origen.isoformat(),
            "datos_hasta": (origen + timedelta(days=6)).isoformat(),
        },
        "champion": {"modelo": champion, "version": version},
        "backtest": {
            "origenes": 8,
            "primer_origen": (origen - timedelta(weeks=14 + 7 * 4)).isoformat(),
            "ultimo_origen": (origen - timedelta(weeks=14)).isoformat(),
        },
        "metricas": raiz,
        "semanas": {
            "real": [s.isoformat() for s in semanas],
            "pronostico": [(origen + timedelta(weeks=h)).isoformat() for h in horizonte],
        },
        "ventanas": [
            {"numero": i + 1, "desde": (lunes + timedelta(days=fin - dias)).isoformat(),
             "hasta": hasta.isoformat(), "dias": dias}
            for i, (dias, fin, hasta) in enumerate(zip(tm.ventanas_dias, fines, hasta_ventanas))
        ],
        "series": [serie(nodo) for nodo in nodos],
    }


def revisar_desgloses(resultados: dict) -> list[str]:
    """Que en cada desglose los hijos sumen el padre, valor por valor, salvo el redondeo a 1 decimal de cada uno: la
    página muestra solo lo publicado y no calcula restos entre nodos."""
    problemas, hijos = [], {}
    for nodo in resultados["series"]:
        hijos.setdefault(nodo["padre"], []).append(nodo)
    for padre in resultados["series"]:
        de_padre = hijos.get(padre["id"])
        if not de_padre:
            continue
        holgura = REDONDEO * (len(de_padre) + 1) + 1e-9
        for campo in ("real", "pronostico", "ventanas", "real_horizonte", "ventanas_real", "pronostico_anterior"):
            for i, valor in enumerate(padre[campo]):
                if valor is not None and abs(sum(h[campo][i] for h in de_padre) - valor) > holgura:
                    problemas.append(f"{resultados['corrida']['origen']}: los hijos de {padre['nombre']} no suman el "
                                     f"nodo en {campo}")
                    break
    return problemas


def revisar_casos(todos: list[dict], niveles) -> list[str]:
    """Los casos que la página tiene que mostrar: un padre con «Otras», un nodo de un nivel con hijos posibles que no se
    desglosa y un nodo que está en un origen y no en el otro."""
    problemas = []
    for resultados in todos:
        origen, nodos = resultados["corrida"]["origen"], resultados["series"]
        padres = {nodo["padre"] for nodo in nodos}
        if not any(nodo["nivel"] == "otras" for nodo in nodos):
            problemas.append(f"{origen}: ningún padre tiene «Otras»")
        if not any(nodo["nivel"] in niveles[1:-1] and nodo["id"] not in padres for nodo in nodos):
            problemas.append(f"{origen}: todos los nodos que pueden desglosarse se desglosan")
    ids = [{nodo["id"] for nodo in resultados["series"]} for resultados in todos]
    if all(grupo == ids[0] for grupo in ids):
        problemas.append("todos los orígenes traen los mismos nodos")
    return problemas


def construir_manifest(todos: list[dict]) -> dict:
    """Una entrada por origen, de la más reciente a la más antigua."""
    todos = sorted(todos, key=lambda r: r["corrida"]["origen"], reverse=True)
    return {
        "version_manifest": 1,
        "generado": max(r["generado"] for r in todos),
        "pronosticos": [
            {
                "id": r["corrida"]["origen"],
                "ruta": f"{r['corrida']['origen']}/results.json",
                "version_esquema": r["version_esquema"],
                "origen": r["corrida"]["origen"],
                "fecha_prediccion": r["corrida"]["fecha_prediccion"],
            }
            for r in todos
        ],
    }


def escribir_json(contenido: dict, ruta: Path, compacto: bool = False) -> None:
    """Los results.json van compactos, como los publica tesis-mlops: con sangría pesarían el doble."""
    formato = {"separators": (",", ":")} if compacto else {"indent": 2}
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(contenido, ensure_ascii=False, allow_nan=False, **formato) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Genera los datos sintéticos de ejemplo de la página.")
    parser.add_argument("--tesis-mlops", type=Path, default=RAIZ.parent / "tesis-mlops")
    parser.add_argument("--salida", type=Path, default=RAIZ / "docs" / "datos" / "ejemplo")
    args = parser.parse_args()

    tm = cargar_tesis_mlops(args.tesis_mlops)
    series = definir_series(tm.esquema.BASE_INDICE)
    todos = [construir_resultados(origen, series, tm) for origen in ORIGENES]
    for resultados in todos:  # se validan todos antes de escribir el primero
        tm.esquema.validar(resultados)
    problemas = [p for resultados in todos for p in revisar_desgloses(resultados)]
    problemas += revisar_casos(todos, tm.arbol.NIVELES)
    if problemas:
        raise SystemExit("El ejemplo no se escribió:\n" + "\n".join(f"- {p}" for p in problemas))
    for resultados in todos:
        escribir_json(resultados, args.salida / resultados["corrida"]["origen"] / "results.json", compacto=True)
    escribir_json(construir_manifest(todos), args.salida / "manifest.json")
    nodos = ", ".join(f"{r['corrida']['origen']}: {len(r['series'])} nodos" for r in todos)
    print(f"{args.salida}: {len(todos)} pronósticos sintéticos ({nodos}) y manifest.json, validados con el esquema de "
          "tesis-mlops")


if __name__ == "__main__":
    main()
