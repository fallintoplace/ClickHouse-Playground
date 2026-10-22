# Full CSV downloads

Query results have a bounded preview (5,000 rows and 2 MB by default). **Download full result (.csv)** reruns the saved query and streams CSV without retaining the entire result in ClickStudio.

## Limits

The bundled local reader can bypass ClickHouse output-row and output-byte limits for full exports while normal previews remain capped. Source-read limits, execution time, memory restrictions, and read-only permissions still apply.

Custom ClickHouse connections keep their existing server output limits. For larger exports, opt in on the relevant connection:

- For a single local environment connection, set `CLICKHOUSE_FULL_EXPORT_UNBOUNDED=true`.
- For a `CONNECTIONS_FILE` profile, set `"fullExportUnbounded": true`.

Only enable this when the ClickHouse user allows `max_result_rows=0` and `max_result_bytes=0` in read-only mode. An export fails if the server enforces a lower limit.

## Data consistency

Full downloads rerun the saved SQL. If the underlying data changes between preview and download, the CSV can contain different results.
