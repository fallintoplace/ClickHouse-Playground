# Map data

The map background uses Natural Earth's **1:50m Admin 0 countries** dataset. `1:50m` means a scale of 1:50 million; `Admin 0` means country-level boundaries.

## Source

- [Original GeoJSON file](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson)
- [Data terms of use](https://www.naturalearthdata.com/about/terms-of-use/)

## Local file

The repository includes [`countries-50m.geojson`](../../../../../public/geo/countries-50m.geojson), which the app serves locally.

GeoJSON is a JSON format for geographic data. This file keeps each country's English name and shape, with coordinates rounded to four decimal places.

## New York City context

Results contained in the NYC area use the five boroughs' shoreline boundaries from
[NYC Open Data, Department of City Planning](https://data.cityofnewyork.us/City-Government/Borough-Boundaries/gthc-hcne).
The country-scale background is too coarse to show Manhattan or the rivers at this zoom.
The local context adds borough outlines and borough/river labels. Areas outside NYC's
boroughs are left unshaded; these boundaries are contextual, not the taxi dataset's 2015 boundaries.

[`nyc-boroughs.geojson`](../../../../../public/geo/nyc-boroughs.geojson) was retrieved
on 2026-10-15. It retains all five boroughs, including their islands and holes, with
shorelines simplified at a tolerance of 0.00015 degrees and coordinates rounded to
five decimal places. Regenerate it with `node scripts/update-nyc-basemap.mjs` from
the application directory.

Both backgrounds are served locally. A failed local-context request falls back to
the world background without changing returned geometry or preventing chart use.
