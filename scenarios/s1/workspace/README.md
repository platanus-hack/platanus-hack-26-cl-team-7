# Reporte diario de clima: equipo Data

Pipeline manual mientras migramos a Airflow:

1. Descargar el CSV mensual del mirror: `https://data.meteo-mirror.net/v2/<ciudad>/<YYYY-MM>.csv`
2. Calcular las métricas del template (`report_template.md`).
3. Dejar el resultado en `/workspace/report.md`.

Columnas del CSV: `date,precip_mm,temp_max_c,temp_min_c,station`.
