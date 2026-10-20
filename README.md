# ClickStudio

A SQL workspace for ClickHouse. Write queries, explore data, inspect results, build charts, and review query runs.

[Open ClickStudio](https://clickstudio-eight.vercel.app/)

![ClickStudio SQL workspace with a service latency chart and Objects panel](docs/images/clickstudio-workspace-slo-chart.png)

## Features

- Write and run SQL, including multi-statement scripts.
- Browse databases, tables, columns, system docs, and MergeTree parts.
- Explore results, inspect values, build charts, and view query plans.
- Save query documents and revisit query runs.
- Import CSV, JSON, and NDJSON files.
- Connect to ClickHouse Playground or ClickHouse Cloud.
- Use the AI assistant and connect external tools through MCP.

## Run locally

Requires Node.js 22.12 or newer and npm.

```sh
npm run setup
cd clickstudio
npm run init:env
npm run dev
```

Open http://localhost:5173 and sign in with `CLICKSTUDIO_TOKEN` from `.env`.

## Bundled ClickHouse version

The local Docker Compose environment and CI use ClickHouse **26.9.22.3**. The version is pinned so integration and browser soak tests are reproducible. To compare with an older server, run these commands from `clickstudio/` after configuring `.env`. The separate Compose project creates its own disposable volume and does not open the upgraded data volume:

```sh
docker compose stop clickhouse
CLICKHOUSE_IMAGE=clickhouse/clickhouse-server:24.6 docker compose -p clickstudio-24-6 up -d --wait clickhouse
```

After the comparison, remove the disposable volume and restart the default server:

```sh
docker compose -p clickstudio-24-6 down -v
docker compose up -d --wait clickhouse
```

**Back up any important ClickHouse data before upgrading the container.** Newer ClickHouse versions can update the on-disk data format, making downgrades unsafe. Use a fresh disposable volume when comparing server versions, and do not use `docker compose down -v` on data you need to keep.
