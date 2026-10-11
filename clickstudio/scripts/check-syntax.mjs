import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function files(path) {
    return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
        if (entry.isDirectory()) {
            return files(join(path, entry.name));
        }

        if (/\.(ts|tsx)$/.test(entry.name)) {
            return [join(path, entry.name)];
        }

        return [];
    });
}
let failed = 0;
const paths = [
    ...['src', 'api', 'tests', 'scripts'].flatMap(p => files(p)),
    ...readdirSync('.').filter(p => p.endsWith('.ts')),
];
for (const path of paths) {
    const source = readFileSync(path, 'utf8');
    if (path.startsWith('src/frontend/') && path.endsWith('.tsx')) {
        const file = ts.createSourceFile(
            path,
            source,
            ts.ScriptTarget.ESNext,
            true,
            ts.ScriptKind.TSX,
        );
        const checkFocus = node => {
            if (
                ts.isJsxAttribute(node) &&
                node.name.getText(file) === 'className' &&
                node.initializer &&
                /\bfocus(?:-visible|-within)?:/.test(node.initializer.getText(file))
            ) {
                console.error(path, 'Put focus styles in base/focus.css instead of JSX utilities.');
                failed++;
            }
            ts.forEachChild(node, checkFocus);
        };
        checkFocus(file);
    }
    const result = ts.transpileModule(source, {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            isolatedModules: true,
        },
    });
    for (const d of result.diagnostics ?? []) {
        if (d.category === ts.DiagnosticCategory.Error) {
            console.error(path, ts.flattenDiagnosticMessageText(d.messageText, '\n'));
            failed++;
        }
    }
}
console.log(
    `${paths.length} TypeScript/TSX files parsed; ${failed} syntax errors. This is NOT dependency-aware typechecking.`,
);
process.exitCode = failed ? 1 : 0;
