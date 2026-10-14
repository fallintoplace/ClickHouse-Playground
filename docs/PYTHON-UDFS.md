# Python executable UDFs

Python authoring and management are available in both **Standard** and **Experimental**
under **Objects > Functions > Python UDFs**.
Existing SQL UDF creation and testing are unchanged. Ordinary SQL can call installed
executable functions in either workspace mode.

## Author and export

Choose **Create Python UDF**, select a template, and define a top-level synchronous
`transform` function. Its parameter names and order must match the argument form.
The supported input and return types are `String`, `Bool`, `Int32`, `Int64`, `UInt64`
and finite `Float64`. Arrays, nullable types, tuples and other serialization formats
are not supported by the authoring form yet.

**Export ZIP** works without management credentials, including sample and Playground
connections. The archive contains:

- `main.py` at the ZIP root, with the authored source and generated stdin/stdout adapter.
- `requirements.txt` when dependencies are specified.
- `function.json` with the Cloud definition, without any credentials or upload ID.
- `function.xml` with an operator-installable self-hosted configuration.

The adapter reads decimal chunk counts followed by JSONEachRow input. It validates
every scalar, writes one `result` object per row, and flushes each chunk. It preserves
64-bit integers using decimal strings on the JSON wire. User `print` output is sent
to stderr. Invalid input, invalid return values and Python exceptions fail the query.
The backend never runs submitted Python.

Packaged assets can be embedded in `main.py` and read as bytes with `read_asset(name)`
from the authored source. This works when the runtime copies only `main.py` into its
script directory. Asset reads do not depend on the working directory or write files.

Templates include string similarity, `python_double`, and token counting with
`tiktoken`. The token-counting template takes one `text String` argument and uses
`o200k_base`: `SELECT count_tokens('Hello world')` returns `2`. Its ZIP
embeds a SHA-256-verified `o200k_base` vocabulary in `main.py`, so the deployed function
does not need a cache directory or outbound network access. It constructs the pinned
tokenizer directly in memory and counts special-token-looking text as ordinary input.
The ZIP also retains the cache file for older source snippets and self-hosted installs.
The vocabulary and tokenizer pattern are
from [tiktoken's public encoding files](https://github.com/openai/tiktoken/blob/main/tiktoken_ext/openai_public.py)
and its MIT license is in `clickstudio/public/udf-assets/LICENSE.txt`.

## Direct Cloud deployment

Use an authenticated, trusted, self-hosted backend. Set these server environment
variables in addition to the existing SQL connection:

```dotenv
CLICKSTUDIO_TOKEN=<at least 32 random characters>
DEMO_MODE=false
CLICKSTUDIO_UDF_ORG_ID=<organization ID>
CLICKSTUDIO_UDF_SERVICE_ID=<intended service ID>
CLICKSTUDIO_UDF_API_KEY_ID=<management API key ID>
CLICKSTUDIO_UDF_API_KEY_SECRET=<management API key secret>
```

The API key needs `control-plane:organization:manage`. SQL username/password
credentials do not grant management access. All four UDF variables must be configured
together. Keys remain on the backend and are covered by its error redactor.
The public hosted API is export-only; it has no management route.

1. Sign into the backend and connect the Cloud SQL connection through that backend.
2. Open the Python creator and enable a 15-minute management session.
3. Explicitly select the configured service. The backend verifies its HTTPS endpoint
   against the active SQL connection and rejects mismatches.
4. Publish the function. To update an existing name, explicitly select **Publish a new
   immutable version**. The backend obtains a fresh single-use upload session,
   uploads a ZIP, and publishes a version.
5. Wait for the build status to become `ready`. Build failures remain visible.
6. Select the version, confirm the target service and rolling-restart warning, and
   attach it. The first executable UDF attachment causes a rolling restart.
7. Refresh Objects until the connected server lists the executable function.
8. Open its **Deployment** tab, select the version to populate supported test argument
   types, and open **Reload pool SQL** after a version update. Review and run the
   generated `SYSTEM RELOAD FUNCTION ON CLUSTER default ...` statement.
9. Use **Test > Run on ClickHouse** and inspect the actual database result.

Defaults: Python 3.11, `executable_pool`, JSONEachRow, `result` return field, chunk
headers enabled, pool size 3, 10-second block timeout, network disabled, and
non-deterministic execution.

Published, build-ready, attached, and loaded are different states. Attachment
responses are never presented as successful SQL execution. Loaded version remains
unverified: the available API metadata cannot prove which code a long-lived worker
is running. Reload the pool and execute a representative SQL test after an update.

A timeout leaves a durable **unknown** outcome with its attempt and upload identifiers.
Another mutation is blocked until a fresh Cloud status request has completed. Check
the actual versions and service attachment before deciding what to do next. The app
does not automatically retry creation or attachment. A new publish gets a fresh upload
URL. Closing the dialog or restarting the backend does not erase an unknown outcome.

This first release has no organization-wide deletion, detach, rollback UI, network
credentials, arbitrary runtime selection, or performance dashboard.

## Self-hosted ClickHouse

Discovery queries `system.functions` for `origin = 'ExecutableUserDefined'`. The
Python section can also contain installed executable functions implemented in other
languages; SQL metadata alone does not identify their runtime. Test signatures can
be entered manually when Cloud metadata is unavailable.

An operator can extract the ZIP into
`/var/lib/clickhouse/user_scripts/<function_name>/`, install Python dependencies in
an appropriate isolated runtime, and place `function.xml` in the server's configured
`user_defined_executable_functions_config` location. Inspect and adapt the absolute
Python script path and interpreter for that installation. ClickStudio does not copy
executables or configuration into a remote server through SQL. Exporting a ZIP does
not install a function.

## Validation

`npm run test:core` validates signatures, ZIP contents, offline tokenizer integrity
and lossless typed SQL inputs. `npm run test:python` runs generated adapters using
known fixture source in Python 3.11 in CI. Management HTTP and adapter tests mock the
Cloud API; they do not modify a live organization. Browser coverage checks export,
typed query routing, unknown outcomes, session renewal and availability in both modes.
A release deployment should additionally complete the live create, build, attach,
reload and SQL-test sequence on its intended Cloud service.

The Cloud management adapter follows the beta
[UDF API](https://clickhouse.com/docs/products/cloud/api-reference/udf/create-udf)
and [executable UDF lifecycle](https://clickhouse.com/docs/cloud/features/user-defined-functions).
