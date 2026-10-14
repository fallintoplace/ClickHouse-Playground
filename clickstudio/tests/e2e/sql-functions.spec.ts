import { test, expect } from '@playwright/test';
import {
    SQL_FUNCTION_CREATION_TEMPLATES,
    SQL_FUNCTION_TEMPLATES,
} from '../../src/shared/database/functions/sql-functions.js';
import { functionsWorkspace } from './sql-functions-helpers.js';
import { workspacePath } from './helpers.js';
import { chooseChartOption as chooseSelectOption } from './chart-control-helpers.js';

test('Existing demo SQL UDFs appear in Objects and execute on ClickHouse', async ({
    page,
}, info) => {
    const workspace = await functionsWorkspace(page, {
        existing: true,
        live: Boolean(process.env.CLICKSTUDIO_UDF_TEST_URL),
    });
    try {
        const tree = page.getByRole('tree', { name: 'Objects', exact: true });
        const rootRows = tree.locator(':scope > .object-tree-branch > [role="treeitem"]');
        await expect(rootRows.first()).toContainText('default');
        await expect(rootRows.last()).toContainText('Functions');
        for (const [index, template] of SQL_FUNCTION_TEMPLATES.entries()) {
            await page
                .getByRole('button', { name: `${template.name} SQL UDF`, exact: true })
                .click();
            const details = page.locator('.sql-function-details');
            await expect(
                details.getByRole('heading', { name: template.name, exact: true }),
            ).toBeVisible();
            await expect(details.getByRole('combobox')).toHaveCount(template.parameters.length);
            await details.screenshot({ path: info.outputPath(`${template.name}-before.png`) });
            await details.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
            await expect(details.locator('.sql-function-output')).toBeVisible();
            await expect(details.locator('.sql-function-output')).toBeInViewport();
            await expect(details.getByText('Executed on ClickHouse', { exact: true })).toHaveCount(
                0,
            );
            if (!index)
                await expect(details.locator('.sql-function-output-items')).toHaveText(
                    '[10, 30, 40]',
                );
            else
                await expect(details.locator('.sql-function-output pre')).toHaveText(
                    '{"a":10,"c":30}',
                );
            await expect(
                details.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
            ).toBeEnabled();
            await page.screenshot({ path: `test-results/sql-functions/${template.name}.png` });
            await page.setViewportSize({ width: 1280, height: 900 });
            await details.screenshot({
                path: info.outputPath(`${template.name}-details.png`),
            });
            await page.setViewportSize({ width: 1280, height: 720 });
            await page.locator('.object-back-button').click();
        }
        expect(workspace.requests.some(body => body.action === 'create-function')).toBe(false);
        expect(workspace.requests.filter(body => body.action === 'run')).toHaveLength(2);
    } finally {
        await workspace.close();
    }
});

test('Functions can be browsed and tested when creation privileges are absent', async ({
    page,
}) => {
    const { requests } = await functionsWorkspace(page, { canCreate: false, existing: true });
    const create = page.getByRole('button', { name: 'Create SQL UDF', exact: true });
    await expect(create).toBeDisabled();
    await expect(create).toHaveAttribute('title', 'CREATE FUNCTION privilege is required.');
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toBeVisible();
    expect(requests.some(body => body.action === 'create-function')).toBe(false);
});

test('Custom function starts blank and creates a testable SQL UDF', async ({ page }) => {
    const workspace = await functionsWorkspace(page, {
        live: Boolean(process.env.CLICKSTUDIO_UDF_TEST_URL),
    });
    try {
        await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
        await expect(
            dialog.getByRole('combobox', { name: 'Template', exact: true }),
        ).toHaveAttribute('data-value', 'custom');
        await expect(dialog.getByRole('region', { name: 'SQL preview', exact: true })).toHaveCount(
            0,
        );
        for (const name of ['Function name', 'Parameter 1 name'])
            await expect(dialog.getByLabel(name, { exact: true })).toHaveValue('');
        await expect(dialog.getByLabel('Function name', { exact: true })).toHaveAttribute(
            'placeholder',
            'e.g. udf_lowercase_utf8',
        );
        await expect(dialog.getByLabel('Expression', { exact: true })).toContainText(
            'e.g. lowerUTF8(value)',
        );
        await expect(dialog.getByLabel('Expression', { exact: true })).toHaveCSS(
            'caret-color',
            'rgb(247, 247, 247)',
        );
        await expect(dialog.getByLabel('Function name', { exact: true })).toBeFocused();
        await expect(
            dialog.getByRole('button', { name: 'Create UDF', exact: true }),
        ).toBeDisabled();
        await dialog.getByLabel('Function name', { exact: true }).fill('udf_increment');
        await dialog.getByLabel('Parameter 1 name', { exact: true }).fill('value');
        await dialog.getByLabel('Expression', { exact: true }).fill('value + 1');
        for (const target of [
            dialog,
            ...(await dialog.locator('input, textarea, .chart-select-trigger').all()),
        ])
            await expect(target).toHaveCSS('border-radius', '4px');
        await page.screenshot({ path: 'test-results/sql-functions/custom-function.png' });
        await dialog.getByRole('button', { name: 'Create UDF', exact: true }).click();
        await expect(page.locator('.sql-function-details h3')).toHaveText('udf_increment');
        await chooseSelectOption(
            page,
            page.getByRole('combobox', { name: 'value input type', exact: true }),
            'integer',
        );
        await page.getByLabel('value', { exact: true }).fill('100');
        await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(page.locator('.sql-function-output pre')).toHaveText('101');
        expect(workspace.requests.find(body => body.action === 'create-function')).toMatchObject({
            name: 'udf_increment',
            parameters: ['value'],
            expression: 'value + 1',
        });
    } finally {
        await workspace.close();
    }
});

test('SQL UDF presets fill the draft and Custom clears it', async ({ page }) => {
    const { requests } = await functionsWorkspace(page, { existing: true });
    await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
    const template = dialog.getByRole('combobox', { name: 'Template', exact: true });
    const name = dialog.getByLabel('Function name', { exact: true });
    const expression = dialog.getByLabel('Expression', { exact: true });
    const parameters = dialog.getByRole('region', { name: 'Parameters', exact: true });

    for (const [index, preset] of SQL_FUNCTION_CREATION_TEMPLATES.entries()) {
        await chooseSelectOption(page, template, String(index));
        await expect(template).toHaveAttribute('data-value', String(index));
        await expect(template).toHaveAttribute('aria-valuetext', preset.label);
        await expect(name).toHaveValue(preset.name);
        await expect(parameters.locator('.sql-function-parameter-row')).toHaveCount(
            preset.parameters.length,
        );
        for (const [parameterIndex, parameter] of preset.parameters.entries())
            await expect(dialog.getByLabel(`Parameter ${parameterIndex + 1} name`)).toHaveValue(
                parameter,
            );
        await expect(expression).toContainText(preset.expression);
        await expect(dialog.getByRole('button', { name: 'Create UDF', exact: true })).toBeEnabled();
    }

    await chooseSelectOption(page, template, 'custom');
    await expect(template).toHaveAttribute('data-value', 'custom');
    await expect(name).toHaveValue('');
    await expect(parameters.locator('.sql-function-parameter-row')).toHaveCount(1);
    await expect(dialog.getByLabel('Parameter 1 name', { exact: true })).toHaveValue('');
    await expect(expression).toContainText('e.g. lowerUTF8(value)');

    await name.fill('custom_after_template');
    await dialog.getByLabel('Parameter 1 name', { exact: true }).fill('value');
    await expression.fill('value + 1');
    await dialog.getByRole('button', { name: 'Create UDF', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests.find(request => request.action === 'create-function')).toMatchObject({
        name: 'custom_after_template',
        parameters: ['value'],
        expression: 'value + 1',
    });
});

test('Adding SQL UDF parameters keeps the expression editor in place to their right', async ({
    page,
}) => {
    await functionsWorkspace(page, { existing: true });
    await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
    const parameters = dialog.getByRole('region', { name: 'Parameters', exact: true });
    const expression = dialog.locator('.function-creation-source');
    const initialExpression = await expression.boundingBox();
    const parameterBounds = await parameters.boundingBox();
    const nameBounds = await dialog.getByLabel('Function name', { exact: true }).boundingBox();
    const templateBounds = await dialog
        .getByRole('combobox', { name: 'Template', exact: true })
        .boundingBox();

    expect(parameterBounds!.x + parameterBounds!.width).toBeLessThan(initialExpression!.x);
    expect(nameBounds!.y).toBe(templateBounds!.y);

    for (let index = 0; index < 3; index++)
        await dialog.getByRole('button', { name: 'Add parameter', exact: true }).click();

    const updatedExpression = await expression.boundingBox();
    expect(updatedExpression!.x).toBe(initialExpression!.x);
    expect(updatedExpression!.y).toBe(initialExpression!.y);
    await expect(dialog.getByLabel('Parameter 4 name', { exact: true })).toBeVisible();
});

test('Create opens a clean custom function form with 4px corners', async ({ page }) => {
    await functionsWorkspace(page, { existing: true });
    await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
    await expect(dialog.getByRole('combobox', { name: 'Template', exact: true })).toHaveAttribute(
        'data-value',
        'custom',
    );
    await expect(dialog.getByLabel('Function name', { exact: true })).toHaveValue('');
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport!.width / 2)).toBeLessThan(2);
    expect(Math.abs(bounds!.y + bounds!.height / 2 - viewport!.height / 2)).toBeLessThan(2);
    await expect(dialog).toHaveCSS('border-radius', '4px');
    await dialog.getByLabel('Function name', { exact: true }).fill('my_function');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
    await expect(dialog.getByLabel('Function name', { exact: true })).toHaveValue('');
});

test('Function search filters globally while preserving database groups', async ({ page }) => {
    await functionsWorkspace(page, { existing: true });
    await page.getByTestId('schema-search').fill('udf_map');
    await expect(
        page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear object search', exact: true }).click();
    await expect(page.getByRole('tree', { name: 'Objects', exact: true })).toContainText('default');
});

test('Invalid creation fields and raw SQL tester input never reach the server', async ({
    page,
}) => {
    const { requests } = await functionsWorkspace(page, { existing: true });
    await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
    await dialog.getByLabel('Function name', { exact: true }).fill('valid_function');
    await dialog.getByLabel('Parameter 1 name', { exact: true }).fill('value');
    await dialog.getByLabel('Expression', { exact: true }).fill('1; DROP TABLE events');
    await expect(dialog.getByRole('button', { name: 'Create UDF', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveText(
        'Enter one SQL expression without statement separators.',
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create SQL UDF', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByLabel('items', { exact: true }).fill('SELECT 1');
    await expect(
        page.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
    ).toBeDisabled();
    expect(requests.some(body => body.action === 'run' || body.action === 'create-function')).toBe(
        false,
    );
});

test('Revoked permissions and server test errors stay visible without automatic retries', async ({
    page,
}) => {
    const { state, requests } = await functionsWorkspace(page, { existing: true });
    state.failCreate = true;
    await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
    await dialog.getByLabel('Function name', { exact: true }).fill('my_function');
    await dialog.getByLabel('Parameter 1 name', { exact: true }).fill('value');
    await dialog.getByLabel('Expression', { exact: true }).fill('value + 1');
    await dialog.getByRole('button', { name: 'Create UDF', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('privilege was revoked');
    expect(requests.filter(body => body.action === 'create-function')).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    state.failRun = true;
    await page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-details').getByRole('alert')).toContainText(
        'input type is invalid',
    );
    await expect(page.locator('.sql-function-output')).toHaveCount(0);
});

test('Changing inputs clears the previous result and prevents stale output during a run', async ({
    page,
}) => {
    const { state } = await functionsWorkspace(page, { existing: true });
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toBeVisible();
    await page.getByLabel('index', { exact: true }).fill('1');
    await expect(page.locator('.sql-function-output')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Function result', exact: true })).toContainText(
        'Arguments changed. Run again to update the result.',
    );
    state.runDelay = 300;
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await page.getByLabel('index', { exact: true }).fill('3');
    await expect(page.locator('.sql-function-output')).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('.sql-function-output')).toHaveCount(0);
});

for (const theme of ['Dark', 'Light']) {
    test(`${theme} function tester explains malformed JSON and styles the error`, async ({
        page,
    }) => {
        const { requests } = await functionsWorkspace(page, { existing: true });
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await page
            .getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true })
            .click();
        const details = page.locator('.sql-function-details');
        await details.getByLabel('items', { exact: true }).fill('[10, 20');

        const error = details.locator('.sql-function-error');
        await expect(error).toHaveText('Enter valid JSON. Check quotes, commas, and brackets.');
        await expect(error).toHaveCSS('border-top-width', '1px');
        await expect(error).toHaveCSS('border-top-style', 'solid');
        expect(await error.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(
            'rgba(0, 0, 0, 0)',
        );
        await expect(
            details.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
        ).toBeDisabled();
        expect(requests.filter(body => body.action === 'run')).toHaveLength(0);
    });
}

test('Reusing a tester draft after switching tabs cannot show its old result on failure', async ({
    page,
}) => {
    const { state } = await functionsWorkspace(page, { existing: true });
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toBeVisible();
    await page.getByRole('tab', { name: 'Getting started.sql', exact: true }).click();
    state.failRun = true;
    state.runDelay = 300;
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toHaveCount(0);
    await expect(page.locator('.sql-function-details').getByRole('alert')).toContainText(
        'input type is invalid',
    );
    await expect(page.locator('.sql-function-output')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Test udf_array_remove_at/ })).toHaveCount(1);
});

test('Map tester preserves duplicate keys in the server-produced output', async ({ page }) => {
    const { state } = await functionsWorkspace(page, { existing: true });
    state.mapJson = '{"a":1,"a":2}';
    await page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }).click();
    const format = page.getByRole('combobox', { name: 'entries input type', exact: true });
    await expect(format).toBeVisible();
    await expect(format).toHaveAttribute('data-value', 'map');
    await chooseSelectOption(page, format, 'json');
    await expect(page.locator('.sql-function-preview pre')).not.toContainText('map(');
    await chooseSelectOption(page, format, 'map');
    await expect(page.locator('.sql-function-preview pre')).toContainText('map(');
    await page.getByLabel('entries', { exact: true }).fill('[["a", 1], ["a", 2], ["b", 3]]');
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output pre')).toHaveText('{"a":1,"a":2}');
});

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} keeps Functions collapsed on refresh failure and recovers through the object refresh`, async ({
        page,
    }) => {
        const { state, requests } = await functionsWorkspace(page, {
            existing: true,
            path: workspacePath(mode),
        });
        await page
            .getByRole('button', {
                name: 'Collapse SQL UDFs',
                exact: true,
            })
            .click();
        state.metadataError = true;
        await page.locator('.object-refresh-action').click();
        await expect(page.locator('.sql-functions-tree')).toBeVisible();
        await expect(page.getByText(/SQL functions could not refresh/)).toBeVisible();
        await expect(page.getByTestId('schema-search')).toHaveAttribute(
            'placeholder',
            'Search objects and functions…',
        );
        await expect(
            page.getByRole('button', { name: 'events MergeTree', exact: true }),
        ).toBeVisible();
        const attempts = requests.filter(body => body.action === 'functions').length;
        state.metadataError = false;
        await page.locator('.object-refresh-action').click();
        await expect(page.locator('.object-refresh-action')).toBeEnabled();
        await page
            .getByRole('button', {
                name: 'Expand SQL UDFs',
                exact: true,
            })
            .click();
        await expect(
            page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
        ).toBeVisible();
        await expect(page.getByTestId('schema-search')).toHaveAttribute(
            'placeholder',
            'Search objects and functions…',
        );
        expect(requests.filter(body => body.action === 'functions')).toHaveLength(attempts + 1);
    });

    test(`${mode} hides Functions for an old backend payload and restores them after refresh`, async ({
        page,
    }) => {
        const { state } = await functionsWorkspace(page, {
            existing: true,
            path: workspacePath(mode),
            invalidCatalog: true,
        });
        await expect(page.locator('.sql-functions-tree')).toHaveCount(0);
        await expect(
            page.getByText('ClickHouse Cloud returned an invalid response.', { exact: true }),
        ).toHaveCount(0);
        await expect(
            page.getByRole('button', { name: 'events MergeTree', exact: true }),
        ).toBeVisible();
        state.invalidCatalog = false;
        await page.locator('.object-refresh-action').click();
        await expect(
            page.getByRole('button', { name: 'udf_map_remove SQL UDF', exact: true }),
        ).toBeVisible();
    });
}

test('SQL UDF dialog and tester remain usable in the light theme', async ({ page }, info) => {
    await functionsWorkspace(page, { existing: true });
    await page.getByRole('radio', { name: 'Light theme', exact: true }).click();
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
    ).toBeEnabled();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
        .locator('.sql-function-details')
        .screenshot({ path: info.outputPath('tester-light-details.png') });
    await page.screenshot({ path: 'test-results/sql-functions/tester-light.png' });
    await page.locator('.object-back-button').click();
    await page.getByRole('button', { name: 'Create SQL UDF', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create SQL Function', exact: true });
    await expect(dialog.getByLabel('Function name', { exact: true })).toBeFocused();
    const expression = dialog.getByLabel('Expression', { exact: true });
    await expect(expression).toHaveCSS('caret-color', 'rgb(27, 48, 61)');
    await page.evaluate(() => {
        document.documentElement.dataset.theme = 'click-dark';
    });
    await expect(expression).toHaveCSS('caret-color', 'rgb(247, 247, 247)');
    await page.evaluate(() => {
        document.documentElement.dataset.theme = 'click-light';
    });
    await expect(expression).toHaveCSS('caret-color', 'rgb(27, 48, 61)');
    await page.screenshot({ path: 'test-results/sql-functions/create-light.png' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(
        dialog.getByRole('button', { name: 'Close Create SQL Function', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Create SQL UDF', exact: true })).toBeFocused();
});

test('Function tester remains disabled until the ClickHouse run finishes', async ({ page }) => {
    const { state, requests } = await functionsWorkspace(page, { existing: true });
    state.runDelay = 1200;
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    const running = page.getByRole('button', { name: 'Running…', exact: true });
    await expect(running).toBeDisabled();
    await expect(page.getByTestId('run-button')).toHaveAttribute('aria-label', 'Cancel');
    await expect(page.getByTestId('run-button')).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Function result', exact: true })).toContainText(
        'Waiting for ClickHouse…',
    );
    await expect.poll(() => requests.filter(body => body.action === 'run').length).toBe(1);
    await expect(running).toBeDisabled();
    await expect(page.locator('.sql-function-output')).toHaveCount(0);
    await expect(page.locator('.sql-function-output')).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
    ).toBeEnabled();
    expect(requests.filter(body => body.action === 'run')).toHaveLength(1);
});

for (const theme of ['Dark', 'Light']) {
    test(`Function tester handles long names and multiline inputs in a narrow ${theme} inspector`, async ({
        page,
    }, info) => {
        await page.setViewportSize({ width: 1024, height: 900 });
        const { state, requests } = await functionsWorkspace(page, { existing: true });
        const name = 'function_with_a_long_name_that_wraps_in_the_inspector';
        const parameter = 'argument_with_a_long_name_that_needs_to_wrap';
        state.functions.push({
            name,
            parameters: [parameter],
            createQuery: `CREATE FUNCTION \`${name}\` AS (\`${parameter}\`) -> ${parameter};`,
        });
        await page.locator('.object-refresh-action').click();
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await page.getByRole('button', { name: `${name} SQL UDF`, exact: true }).click();
        const details = page.locator('.sql-function-details');
        await expect(
            page.getByRole('region', { name: 'Function result', exact: true }),
        ).toContainText('No result yet.');
        const input = details.getByLabel(parameter, { exact: true });
        await chooseSelectOption(
            page,
            details.getByRole('combobox', { name: `${parameter} input type`, exact: true }),
            'array',
        );
        await input.fill('[\n  10, 20, 30, 40\n]');
        await expect(details.locator('.sql-function-preview pre')).toContainText(
            '[10, 20, 30, 40]',
        );
        await expect(input).toHaveAttribute('aria-describedby', /-input-hint-0$/);
        await expect(input).toHaveAccessibleDescription(
            'JSON array, e.g. [1, 2, 3] or ["a", "b"].',
        );
        for (const target of [details, input, details.locator('.sql-function-preview')]) {
            expect(
                await target.evaluate(element => element.scrollWidth - element.clientWidth),
            ).toBeLessThanOrEqual(1);
        }
        await details.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
        await expect(details.locator('.sql-function-output')).toHaveText('[10, 30, 40]');
        await expect(
            details.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
        ).toBeEnabled();
        expect(requests.filter(body => body.action === 'run')).toHaveLength(1);
        await details.screenshot({
            path: info.outputPath(`narrow-function-${theme.toLowerCase()}.png`),
        });
    });
}

test('Switching SQL tabs during a function test keeps Run disabled and shows the completed result', async ({
    page,
}) => {
    const { state, requests } = await functionsWorkspace(page, { existing: true });
    state.runDelay = 1500;
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Running…', exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: 'Getting started.sql', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Running…', exact: true })).toBeDisabled();
    await expect(page.locator('.sql-function-output')).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Run on ClickHouse', exact: true }),
    ).toBeEnabled();
    expect(requests.filter(body => body.action === 'run')).toHaveLength(1);
});

test('Reopening a function card adopts its running query without submitting it twice', async ({
    page,
}) => {
    const { state, requests } = await functionsWorkspace(page, { existing: true });
    state.runDelay = 2000;
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Running…', exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: 'Getting started.sql', exact: true }).click();
    await page.locator('.object-back-button').click();
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toBeVisible();
    expect(requests.filter(body => body.action === 'run')).toHaveLength(1);
});

test('Function tester never adopts a running EXPLAIN action as its result', async ({ page }) => {
    const { state, requests } = await functionsWorkspace(page, { existing: true });
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-output')).toBeVisible();
    state.runDelay = 1500;
    await page.getByRole('button', { name: 'EXPLAIN PLAN', exact: true }).click();
    await expect.poll(() => requests.filter(body => body.action === 'run').length).toBe(2);
    await page.getByRole('tab', { name: 'Getting started.sql', exact: true }).click();
    await page.locator('.object-back-button').click();
    await page.getByRole('button', { name: 'udf_array_remove_at SQL UDF', exact: true }).click();
    await page.getByRole('button', { name: 'Run on ClickHouse', exact: true }).click();
    await expect(page.locator('.sql-function-details').getByRole('alert')).toContainText(
        'Another action is running',
    );
    await expect(page.locator('.sql-function-output')).toHaveCount(0);
    expect(requests.filter(body => body.action === 'run')).toHaveLength(2);
});
