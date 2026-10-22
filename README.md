# ClickHouse Playground

A SQL workspace for ClickHouse to write queries, explore data, and visualize results.

[Try ClickHouse Playground](https://clickhouse-playground.vercel.app/)

![ClickHouse Playground SQL workspace](docs/images/clickstudio-workspace-slo-chart.png)

## Features

- Run SQL scripts and browse databases, tables, and columns.
- Inspect results, query plans, charts, and previous runs.
- Import CSV, JSON, and NDJSON, or connect to ClickHouse Cloud.
- Use the AI assistant and MCP integrations.

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm run setup
cd clickstudio
npm run init:env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and sign in with `CLICKSTUDIO_TOKEN` from `clickstudio/.env`.

## CSV exports

Previews are limited to 5,000 rows and 2 MB by default. Full CSV downloads rerun the query, so exported data may differ from the preview.
