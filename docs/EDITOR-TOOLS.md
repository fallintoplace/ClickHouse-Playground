# SQL editing tools

Use these tools to navigate SQL scripts, add query patterns, and complete names as you type.

## Editor sessions

Switching query tabs or detaching and docking the editor preserves undo, redo, folded regions, scroll position, and selections for each draft. Reloading the page restores the draft text and main selection.

SQL execution and editor hints share a lexer that recognizes comments, escaped quotes, heredocs, and statement boundaries. The statement outline updates when you edit the document.

## ClickHouse snippets

A snippet is an editable query template. Type `ch_` and open autocomplete with **Ctrl+Space**, then choose a template.

The templates include hourly counts, top values, P50/P95/P99 percentiles, the latest value per key with `argMax`, conditional counts, and `EXPLAIN indexes = 1`. A percentile describes a value's position in a distribution; for example, P50 is the median.

Press **Tab / Shift+Tab** to move between placeholder fields. When a placeholder appears more than once, changing one copy updates the linked copies. The editor's normal undo action also works with snippet insertion.

Formatting creates a separate undo step. **Cmd+S / Ctrl+S** saves the active draft in both the workspace and detached editor.

## SQL diagnostics

Syntax issues appear as editor underlines and gutter markers. Hover a marker to read its details. Diagnostics update with the current SQL and disappear when corrected, including quote, comment, and heredoc errors when the native parser is unavailable.

Run failures, including errors caught before submission, appear in Results with the submitted SQL. Editor highlights apply only while that SQL still matches the draft. Save and Restore warnings appear beside Save; click the warning to read its details. A successful retry clears only that operation's feedback.

## Completion

Autocomplete suggests SQL keywords, ClickHouse functions, schema names and types, function descriptions, table aliases, and tables with database-qualified names.

For example, typing `e.` offers columns from the table with alias `e`. Typing `database.` offers tables from that database.

Suggestions exclude comments, strings, heredocs, and quoted identifier prefixes. Alias hints use the statement you are editing. Schema names that need quoting are inserted with quotes.

## Sample and live workflows

Try the tools in the sample workspace with repeatable example responses. Connect to a live ClickHouse server to run SQL with the same editor tools.

## Validation

From the repository root, run:

```sh
cd clickstudio
npm run test:core
npm run typecheck
npm run test:e2e -- tests/e2e/editor-tools.spec.ts
```

The tests cover statement boundaries, snippet insertion, placeholder navigation, aliases, completion positions, large schemas, tab and detached editor sessions, undo, lexical exclusions, error locations, and keyword completion.
