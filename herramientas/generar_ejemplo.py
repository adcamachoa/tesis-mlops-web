"""Genera los datos sintéticos de la página: un results.json por origen y el manifest.json que los lista.

Los números son inventados con una semilla fija; no salen de ningún dato real. Cada results.json se valida con el
esquema de tesis-mlops (src/common/results_schema.py) antes de escribir, y si alguno no lo cumple no se escribe nada.
De tesis-mlops solo se lee: se importa sin dejar __pycache__ allá.

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

RAIZ = Path(__file__).resolve().parent.parent
SEMILLA = 2026
ORIGENES = (date(2026, 9, 14), date(2026, 10, 12))  # lunes de la última semana con venta real de cada pronóstico
SEMANAS_REALES = 52
SERIES_TOP = 20
SERIES_POR_SUBMARCA = 20
SUBMARCAS = {"Submarca A": 1.0, "Submarca B": 0.6, "Submarca C": 0.35}  # tamaño relativo
TENDENCIA = {"Submarca A": -0.06, "Submarca B": 0.04, "Submarca C": 0.0}  # cambio por año
PICOS = {(11, 20): 2.4, (5, 28): 1.8}  # (mes, día): la semana que contiene esa fecha vende tantas veces más
RUIDO_REAL = 0.12
RUIDO_PRONOSTICO = 0.05
SESGO_PRONOSTICO = {ORIGENES[0]: 1.02, ORIGENES[1]: 0.94}
DECIMALES_INDICE = 1
DECIMALES_METRICA = 4

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


def cargar_tesis_mlops(ruta: Path) -> SimpleNamespace:
    """El esquema y las constantes de results.json, importados de tesis-mlops solo para leer."""
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(ruta / "src"))
    from common import results_schema
    from common.features import HORIZONTE
    from common.metrics import METRICAS, VENTANAS_DIAS

    return SimpleNamespace(esquema=results_schema, horizonte=HORIZONTE, metricas=METRICAS, ventanas_dias=VENTANAS_DIAS)


def definir_series() -> list[dict]:
    """Las series inventadas: 20 por submarca, cada una con su tamaño y su temporada."""
    azar = random.Random(SEMILLA)
    series = []
    for submarca, tamano in SUBMARCAS.items():
        for i in range(SERIES_POR_SUBMARCA):
            departamento = i % 3 + 1
            series.append(
                {
                    "nombre": f"{submarca} | Departamento {departamento} | Categoría {departamento}.{i % 4 + 1} "
                    f"| Tipo {len(series) + 1}",
                    "submarca": submarca,
                    "nivel": 40 * tamano * azar.lognormvariate(0, 0.9),
                    "amplitud": azar.uniform(0.1, 0.35),
                    "fase": azar.uniform(-20, 20),
                }
            )
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


def por_ventana(semanal: list[float], ventanas_dias) -> list[float]:
    """Reparte el pronóstico de cada semana entre las ventanas, 1/7 por día."""
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


def construir_resultados(origen: date, series: list[dict], tm: SimpleNamespace) -> dict:
    """Un results.json sintético con la forma que arma export_results.py en tesis-mlops."""
    semanas = [origen - timedelta(weeks=SEMANAS_REALES - 1 - i) for i in range(SEMANAS_REALES)]
    horizonte = range(1, tm.horizonte + 1)
    real = {s["nombre"]: [venta_real(s, lunes) for lunes in semanas] for s in series}
    semanal = {s["nombre"]: [pronostico(s, origen, h) for h in horizonte] for s in series}
    ventanas = {nombre: por_ventana(valores, tm.ventanas_dias) for nombre, valores in semanal.items()}
    factor = tm.esquema.BASE_INDICE * SEMANAS_REALES / sum(map(sum, real.values()))

    def serie(nivel: str, nombre: str, miembros: list[str]) -> dict:
        def suma(tabla: dict) -> list[float]:
            return [round(sum(v) * factor, DECIMALES_INDICE) for v in zip(*(tabla[m] for m in miembros))]

        return {"nivel": nivel, "nombre": nombre, "real": suma(real), "pronostico": suma(semanal),
                "ventanas": suma(ventanas)}

    principales = sorted(real, key=lambda nombre: sum(real[nombre]), reverse=True)[:SERIES_TOP]
    lunes = origen + timedelta(weeks=1)
    fines = [sum(tm.ventanas_dias[: i + 1]) for i in range(len(tm.ventanas_dias))]
    dia_corrida = origen + timedelta(days=16)
    total_ventanas = sum(sum(v) for v in ventanas.values()) * factor
    champion, version = CHAMPION[origen]
    return {
        "version_esquema": tm.esquema.VERSION,
        "generado": datetime.combine(dia_corrida, time(10, 0)).isoformat(),
        "escala": tm.esquema.ESCALA,
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
        "metricas": metricas(origen, tm, total_ventanas / (len(series) * len(tm.ventanas_dias))),
        "semanas": {
            "real": [s.isoformat() for s in semanas],
            "pronostico": [(origen + timedelta(weeks=h)).isoformat() for h in horizonte],
        },
        "ventanas": [
            {"numero": i + 1, "desde": (lunes + timedelta(days=fin - dias)).isoformat(),
             "hasta": (lunes + timedelta(days=fin - 1)).isoformat(), "dias": dias}
            for i, (dias, fin) in enumerate(zip(tm.ventanas_dias, fines))
        ],
        "series": [
            serie("total", "Total", list(real)),
            *(serie("submarca", s, [x["nombre"] for x in series if x["submarca"] == s]) for s in sorted(SUBMARCAS)),
            *(serie("serie", nombre, [nombre]) for nombre in principales),
        ],
    }


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


def escribir_json(contenido: dict, ruta: Path) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(contenido, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Genera los datos sintéticos de ejemplo de la página.")
    parser.add_argument("--tesis-mlops", type=Path, default=RAIZ.parent / "tesis-mlops")
    parser.add_argument("--salida", type=Path, default=RAIZ / "docs" / "datos" / "ejemplo")
    args = parser.parse_args()

    tm = cargar_tesis_mlops(args.tesis_mlops)
    series = definir_series()
    todos = [construir_resultados(origen, series, tm) for origen in ORIGENES]
    for resultados in todos:  # se validan todos antes de escribir el primero
        tm.esquema.validar(resultados)
    for resultados in todos:
        escribir_json(resultados, args.salida / resultados["corrida"]["origen"] / "results.json")
    escribir_json(construir_manifest(todos), args.salida / "manifest.json")
    print(f"{args.salida}: {len(todos)} pronósticos sintéticos y manifest.json, validados con el esquema de tesis-mlops")


if __name__ == "__main__":
    main()
