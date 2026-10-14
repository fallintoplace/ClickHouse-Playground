import { test, expect } from '@playwright/test';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';
import { chooseChartOption as chooseSelectOption } from './chart-control-helpers.js';

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} uses the shared keyboard-selectable SQL input type control`, async ({ page }) => {
        await functionsWorkspace(page, { path: workspacePath(mode), existing: true });
        await page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }).click();
        const details = page.locator('.sql-function-details');
        const format = details.getByRole('combobox', { name: 'entries input type', exact: true });
        await expect(details.locator('select')).toHaveCount(0);
        await format.focus();
        await page.keyboard.press('ArrowDown');
        const listbox = page.getByRole('listbox', { name: 'entries input type', exact: true });
        await expect(listbox).toBeFocused();
        await expect(listbox.getByRole('option')).toHaveText([
            'String',
            'Integer',
            'Float',
            'Boolean',
            'Array',
            'Map',
            'Null',
            'JSON (advanced)',
        ]);
        await page.keyboard.press('Home');
        await page.keyboard.press('Enter');
        await expect(format).toBeFocused();
        await expect(format).toHaveAttribute('data-value', 'string');
        await expect(details.locator('.sql-function-preview pre')).not.toContainText('map(');
        await page.keyboard.press('ArrowDown');
        await expect(listbox).toBeFocused();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await expect(format).toHaveAttribute('data-value', 'json');
        await expect(details.getByLabel('entries', { exact: true })).toHaveValue(
            JSON.stringify('[["a", 10], ["b", 20], ["c", 30]]'),
        );
        await chooseSelectOption(page, format, 'string');
        await chooseSelectOption(page, format, 'map');
        await expect(details.locator('.sql-function-preview pre')).toContainText('map(');
    });

    test(`${mode} SQL input types validate values and submit their matching literals`, async ({
        page,
    }, info) => {
        const { state, requests } = await functionsWorkspace(page, { path: workspacePath(mode) });
        state.functions.push({
            name: 'identity_demo',
            parameters: ['value'],
            createQuery: 'CREATE FUNCTION identity_demo AS (value) -> value;',
        });
        await page.locator('.object-refresh-action').click();
        await page.getByRole('button', { name: 'identity_demo SQL UDF', exact: true }).click();
        const details = page.locator('.sql-function-details');
        const input = details.getByLabel('value', { exact: true });
        const type = details.getByRole('combobox', { name: 'value input type', exact: true });
        const run = details.getByRole('button', { name: 'Run on ClickHouse', exact: true });
        await expect(type).toHaveAttribute('data-value', 'string');
        await expect(input).toHaveValue('');
        await expect(input).toHaveAccessibleDescription('Text, no quotes needed.');
        await input.fill("hello'\\\nworld");
        await run.click();
        await expect(details.locator('.sql-function-output')).toBeVisible();
        expect(requests.filter(request => request.action === 'run').at(-1)?.sql).toContain(
            "`identity_demo`('hello\\'\\\\\nworld')",
        );
        await chooseSelectOption(page, type, 'json');
        await expect(input).toHaveValue(JSON.stringify("hello'\\\nworld"));
        await chooseSelectOption(page, type, 'string');
        await expect(input).toHaveValue("hello'\\\nworld");
        for (const [kind, value, sql] of [
            ['integer', '9007199254740993', '9007199254740993'],
            ['float', '2.0', "CAST('2.0', 'Float64')"],
            ['boolean', 'true', 'true'],
            ['array', '[1, 2, 3]', '[1, 2, 3]'],
            ['map', '[["a", 1], ["a", 2]]', "map('a', 1, 'a', 2)"],
            ['json', 'null', 'NULL'],
        ]) {
            await chooseSelectOption(page, type, kind!);
            await input.fill(value!);
            await expect(details.locator('.sql-function-output')).toHaveCount(0);
            await run.click();
            await expect(details.locator('.sql-function-output')).toBeVisible();
            expect(requests.filter(request => request.action === 'run').at(-1)?.sql).toContain(
                `\`identity_demo\`(${sql})`,
            );
        }
        for (const [kind, value, error] of [
            ['integer', '2.0', 'whole number'],
            ['float', 'Infinity', 'finite decimal'],
            ['boolean', 'yes', 'true or false'],
            ['array', '42', 'JSON array'],
            ['map', '{}', 'map as'],
            ['json', '{}', 'JSON strings'],
        ]) {
            await chooseSelectOption(page, type, kind!);
            await input.fill(value!);
            await expect(run).toBeDisabled();
            await expect(details.getByRole('status')).toContainText(error!);
        }
        expect(requests.filter(request => request.action === 'run')).toHaveLength(7);
        await chooseSelectOption(page, type, 'string');
        await input.fill('keep this text');
        await chooseSelectOption(page, type, 'null');
        await expect(input).toBeDisabled();
        await expect(input).toHaveValue('NULL');
        await run.click();
        await expect
            .poll(() => requests.filter(request => request.action === 'run').length)
            .toBe(8);
        await expect(run).toBeEnabled();
        await expect(details.locator('.sql-function-output')).toBeVisible();
        expect(requests.filter(request => request.action === 'run').at(-1)?.sql).toContain(
            '`identity_demo`(NULL)',
        );
        await chooseSelectOption(page, type, 'string');
        await expect(input).toBeEnabled();
        await expect(input).toHaveValue('keep this text');
        await expect(details.locator('.sql-function-output')).toHaveCount(0);
        await details.screenshot({ path: info.outputPath('plain-string-input.png') });
        await chooseSelectOption(page, type, 'null');
        await chooseSelectOption(page, type, 'json');
        await expect(input).toHaveValue('"keep this text"');
        await expect(run).toBeEnabled();
        await chooseSelectOption(page, type, 'null');
        await chooseSelectOption(page, type, 'string');
        await expect(input).toHaveValue('keep this text');
        await chooseSelectOption(page, type, 'json');
        await details.screenshot({ path: info.outputPath('advanced-json-input.png') });
    });

    test(`${mode} signature refresh preserves separate values for duplicate argument labels`, async ({
        page,
    }) => {
        const { state } = await functionsWorkspace(page, { path: workspacePath(mode) });
        state.executableFunctions.push({
            name: 'duplicates',
            createQuery: '',
            arguments: [
                { name: 'arg1', type: 'String' },
                { name: 'arg1', type: 'String' },
            ],
        });
        await page.locator('.object-refresh-action').click();
        await page.getByRole('button', { name: 'duplicates Executable UDF', exact: true }).click();
        const inputs = page.getByLabel('arg1', { exact: true });
        await inputs.nth(0).fill('first');
        await inputs.nth(1).fill('second');
        state.executableFunctions[0]!.arguments!.push({ name: 'third', type: 'Bool' });
        await page.getByRole('button', { name: 'Refresh signature', exact: true }).click();
        await expect(page.locator('.sql-function-argument')).toHaveCount(3);
        await expect(inputs.nth(0)).toHaveValue('first');
        await expect(inputs.nth(1)).toHaveValue('second');
        await expect(page.getByLabel('third', { exact: true })).toHaveValue('false');
    });

    for (const theme of ['Dark', 'Light']) {
        test(`${mode} ${theme} detects executable signatures and renders compact fixed rows`, async ({
            page,
        }, info) => {
            await page.setViewportSize({ width: 1440, height: 1000 });
            const { state, requests } = await functionsWorkspace(page, {
                path: workspacePath(mode),
                existing: true,
            });
            state.executableFunctions.push({
                name: 'python_double',
                createQuery: '',
                arguments: [
                    { name: 'value', type: 'Int64' },
                    { name: 'text', type: 'String' },
                    { name: 'enabled', type: 'Bool' },
                ],
            });
            await page.locator('.object-refresh-action').click();
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await page
                .getByRole('button', { name: 'python_double Executable UDF', exact: true })
                .click();
            const details = page.locator('.sql-function-details');
            await expect(details.locator('.object-details-hero')).toContainText('Server-wide');
            await expect(details.locator('.sql-function-argument')).toHaveCount(3);
            await expect(details.locator('.sql-function-arguments-heading')).not.toContainText(
                'detected',
            );
            await expect(details.getByRole('combobox')).toHaveCount(0);
            await expect(
                details.getByRole('button', { name: 'Add argument', exact: true }),
            ).toHaveCount(0);
            await expect(details.getByLabel('text', { exact: true })).toHaveValue('');
            await expect(details.getByLabel('enabled', { exact: true })).toHaveValue('false');
            await details.getByLabel('value', { exact: true }).fill('21');
            await details.getByLabel('text', { exact: true }).fill("hello'\nworld");
            await details.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
            await expect(details.locator('.sql-function-output')).toHaveText('"42"');
            await expect(
                details.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
            ).toBeEnabled();
            expect(requests.find(request => request.action === 'run')?.sql).toContain(
                "`python_double`(CAST('21', 'Int64'), CAST('hello\\'\nworld', 'String'), CAST('false', 'Bool'))",
            );
            const preview = details.locator('.sql-function-preview');
            await expect(preview).not.toHaveAttribute('open');
            await preview.locator('summary').click();
            await expect(preview.locator('pre')).toBeVisible();
            await preview.locator('summary').click();
            await details.getByRole('tab', { name: 'Definition', exact: true }).click();
            await details.getByRole('tab', { name: 'Test', exact: true }).click();
            await expect(details.getByLabel('value', { exact: true })).toHaveValue('21');
            await details.screenshot({ path: info.outputPath('detected-arguments.png') });
            await page.setViewportSize({ width: 900, height: 740 });
            for (const element of [
                details,
                details.locator('.sql-function-arguments'),
                details.getByLabel('text', { exact: true }),
            ])
                expect(
                    await element.evaluate(element => element.scrollWidth - element.clientWidth),
                ).toBeLessThanOrEqual(1);
            await details.screenshot({ path: info.outputPath('narrow-detected-arguments.png') });
        });
    }

    test(`${mode} manual signature edits preserve existing values and discard removed inputs`, async ({
        page,
    }) => {
        const { state } = await functionsWorkspace(page, { path: workspacePath(mode) });
        state.executableFunctions.push({ name: 'python_double', createQuery: '' });
        await page.locator('.object-refresh-action').click();
        await page
            .getByRole('button', { name: 'python_double Executable UDF', exact: true })
            .click();
        const details = page.locator('.sql-function-details');
        await expect(details.locator('.object-details-hero')).toContainText('Server-wide');
        await expect(details.locator('.sql-function-arguments-heading')).toContainText(
            'Manual signature',
        );
        await details.getByLabel('arg1', { exact: true }).fill('21');
        await details.getByRole('button', { name: 'Add argument', exact: true }).click();
        await expect(details.getByLabel('arg1', { exact: true })).toHaveValue('21');
        await details.getByLabel('arg2', { exact: true }).fill('discard this');
        await chooseSelectOption(
            page,
            details.getByRole('combobox', { name: 'Test argument 1 type', exact: true }),
            'Int64',
        );
        await expect(details.getByLabel('arg1', { exact: true })).toHaveValue('21');
        await expect(details.getByLabel('arg2', { exact: true })).toHaveValue('discard this');
        await details.getByRole('button', { name: 'Remove argument', exact: true }).click();
        await expect(details.getByLabel('arg1', { exact: true })).toHaveValue('21');
        await details.getByRole('button', { name: 'Add argument', exact: true }).click();
        await expect(details.getByLabel('arg2', { exact: true })).toHaveValue('');
    });

    test(`${mode} metadata refresh fixes a manual signature without losing matching inputs`, async ({
        page,
    }) => {
        const { state } = await functionsWorkspace(page, { path: workspacePath(mode) });
        state.executableFunctions.push({ name: 'python_double', createQuery: '' });
        await page.locator('.object-refresh-action').click();
        await page
            .getByRole('button', { name: 'python_double Executable UDF', exact: true })
            .click();
        await page.getByLabel('arg1', { exact: true }).fill('21');
        state.executableFunctions[0] = {
            name: 'python_double',
            createQuery: '',
            arguments: [
                { name: 'arg1', type: 'Int64' },
                { name: 'suffix', type: 'String' },
            ],
        };
        await page.getByRole('button', { name: 'Refresh signature', exact: true }).click();
        await expect(page.locator('.sql-function-argument')).toHaveCount(2);
        await expect(page.getByLabel('arg1', { exact: true })).toHaveValue('21');
        await expect(page.getByLabel('suffix', { exact: true })).toHaveValue('');
        await expect(page.getByRole('button', { name: 'Add argument', exact: true })).toHaveCount(
            0,
        );
    });
}

test('Detected unsupported and zero-argument signatures remain accurate without invented String inputs', async ({
    page,
}) => {
    const { state, requests } = await functionsWorkspace(page);
    state.executableFunctions.push(
        {
            name: 'unsupported',
            createQuery: '',
            arguments: [{ name: 'items', type: 'Array(String)' }],
        },
        { name: 'no_inputs', createQuery: '', arguments: [] },
    );
    await page.locator('.object-refresh-action').click();
    await page.getByRole('button', { name: 'unsupported Executable UDF', exact: true }).click();
    await expect(page.locator('.sql-function-argument-type')).toHaveText('Array(String)');
    await expect(page.locator('.sql-function-arguments')).toContainText(
        'Call this function in the SQL editor.',
    );
    await expect(
        page.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
    ).toBeDisabled();
    await page.locator('.object-back-button').click();
    await page.getByRole('button', { name: 'no_inputs Executable UDF', exact: true }).click();
    await expect(page.locator('.object-details-hero')).toContainText('No arguments');
    await expect(page.locator('.sql-function-argument')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add argument', exact: true })).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect
        .poll(() => requests.some(request => String(request.sql).includes('`no_inputs`()')))
        .toBe(true);
});
