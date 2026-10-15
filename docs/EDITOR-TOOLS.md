# SQL editing tools

Use these tools to navigate SQL scripts, inspect schema information, and diagnose queries.

## Editor sessions

Switching query tabs or detaching and docking the editor preserves undo, redo, folded regions, scroll position, and selections for each draft. Reloading the page restores the draft text and main selection.

SQL execution and editor hints share a lexer that recognizes comments, escaped quotes, heredocs, and statement boundaries. The statement outline updates when you edit the document.

## Formatting and saving

Formatting creates a separate undo step. **Cmd+S / Ctrl+S** saves the active draft in both the workspace and detached editor.

## SQL diagnostics

Syntax issues appear as editor underlines and gutter markers. Hover a marker to read its details. Diagnostics update with the current SQL and disappear when corrected, including quote, comment, and heredoc errors when the native parser is unavailable.

Run failures, including errors caught before submission, appear in Results with the submitted SQL. Editor highlights apply only while that SQL still matches the draft. Save and Restore warnings appear beside Save; click the warning to read its details. A successful retry clears only that operation's feedback.

## Schema information

Hover a table or column name to see its schema information. Column hints include the type and any comment; table hints include the engine. Function calls show a short description when available.

Hover hints use table aliases from the statement you are editing and exclude string and comment text.

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

The tests cover statement boundaries, aliases, schema hover, tab and detached editor sessions, undo, diagnostics, syntax highlighting, and the absence of autocomplete while typing or using shortcuts.
