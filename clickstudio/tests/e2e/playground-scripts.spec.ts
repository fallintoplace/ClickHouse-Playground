import { test, expect, type Page } from '@playwright/test';
import { replaceSql } from './helpers.js';
import { jsonRecord } from '../helpers/type-guards.js';
import { connectPreviewCloud, mockCloudEndpoint } from './cloud-import-helpers.js';

const script =
    "SELECT 'first;value' AS step;\n-- ; is a comment\nSELECT 'second' AS step;\nSELECT 'third' AS step;";

function deferred() {
    let resolve: () => void = () => {};
    const promise = new Promise<void>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

async function mockPlayground(
    page: Page,
    handler: (sql: string) => Promise<{ body: string; status?: number }>,
) {
    await page.route('https://sql-clickhouse.clickhouse.com:8443/**', async route => {
        const sql = route.request().postData() ?? '';
        const response = /first;value|second|third|missing_script_value/.test(sql)
            ? await handler(sql)
            : {
                  body: sql.includes('SELECT version()')
                      ? '["version"]\n["String"]\n["26.1.1.1"]\n'
                      : '[]\n[]\n',
              };
        await route.fulfill({ ...response, contentType: 'text/plain' }).catch(() => undefined);
    });
}

function rows(value: string) {
    return { body: `["step"]\n["String"]\n${JSON.stringify([value])}\n` };
}

async function storedScript(page: Page, connectionId = 'playground') {
    const value: unknown = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('clickstudio:vercel-preview-database:v1') ?? '{}'),
    );
    const database = jsonRecord(value);
    const scripts = Array.isArray(database.scripts) ? database.scripts : [];
    return scripts.map(item => jsonRecord(item)).find(item => item.connectionId === connectionId);
}

for (const mode of ['/', '/experimental']) {
    test(`Playground runs a complete script sequentially and reopens each result in ${mode}`, async ({
        page,
    }) => {
        const requests: string[] = [];
        const gates = [deferred(), deferred(), deferred()];
        await mockPlayground(page, async sql => {
            const index = requests.length;
            requests.push(sql);
            await gates[index]!.promise;
            return rows(['first;value', 'second', 'third'][index]!);
        });
        try {
            await page.goto(`${mode}?connection=playground`);
            await replaceSql(page, script);
            await expect(page.getByTestId('run-button')).toBeEnabled();
            await page.getByTestId('run-button').click();
            await expect.poll(() => requests.length).toBe(1);
            const pending = page.getByRole('region', {
                name: 'Script statement results',
                exact: true,
            });
            await expect(
                pending.getByRole('button', { name: 'Statement 1: running' }),
            ).toBeVisible();
            await expect(
                pending.getByRole('button', { name: 'Statement 2: pending' }),
            ).toBeDisabled();
            expect(requests).toHaveLength(1);
            gates[0]!.resolve();
            await expect.poll(() => requests.length).toBe(2);
            await expect(
                pending.getByRole('button', { name: 'Statement 1: succeeded' }),
            ).toBeEnabled();
            expect(requests).toHaveLength(2);
            gates[1]!.resolve();
            await expect.poll(() => requests.length).toBe(3);
            gates[2]!.resolve();
            await expect.poll(async () => (await storedScript(page))?.status).toBe('succeeded');
            await expect(pending).toHaveCount(0);
            for (const [index, value] of ['first;value', 'second', 'third'].entries()) {
                await page.locator('.script-results-trigger').click();
                await page
                    .getByRole('menuitemradio', {
                        name: `Statement ${index + 1}: succeeded`,
                        exact: true,
                    })
                    .click();
                await expect(
                    page
                        .getByRole('region', { name: 'Query results', exact: true })
                        .locator('tbody'),
                ).toContainText(value);
            }
            await page.reload();
            await page.locator('.script-results-trigger').click();
            await expect(page.getByRole('menuitemradio')).toHaveCount(3);
            expect(requests).toHaveLength(3);
        } finally {
            gates.forEach(gate => gate.resolve());
        }
    });
}

test('Playground rejects a script containing writes before sending its first query', async ({
    page,
}) => {
    const requests: string[] = [];
    await mockPlayground(page, async sql => {
        requests.push(sql);
        return rows('unexpected');
    });
    await page.goto('/?connection=playground');
    await replaceSql(page, "SELECT 'first;value' AS step; INSERT INTO github.events VALUES (1)");
    await page.getByTestId('run-button').click();
    await expect(page.locator('.result-failure-summary')).toBeVisible();
    await expect(page.locator('.result-failure-summary')).toHaveText(
        'The public Playground connection accepts read-only SQL only.',
    );
    expect(requests).toEqual([]);
    expect(await storedScript(page)).toBeUndefined();
});

test('Playground stops after a failed statement and preserves the earlier result', async ({
    page,
}) => {
    const requests: string[] = [];
    await mockPlayground(page, async sql => {
        requests.push(sql);
        return sql.includes('missing_script_value')
            ? {
                  status: 404,
                  body: 'Code: 47. DB::Exception: Unknown identifier missing_script_value. (UNKNOWN_IDENTIFIER)',
              }
            : rows('first;value');
    });
    await page.goto('/?connection=playground');
    await replaceSql(
        page,
        "SELECT 'first;value' AS step; SELECT missing_script_value; SELECT 'third' AS step",
    );
    await page.getByTestId('run-button').click();
    await expect.poll(async () => (await storedScript(page))?.status).toBe('partial');
    expect(requests).toHaveLength(2);
    await page.locator('.script-results-trigger').click();
    await expect(page.getByRole('menuitemradio', { name: 'Statement 3: skipped' })).toBeDisabled();
    await page.getByRole('menuitemradio', { name: 'Statement 2: failed' }).click();
    await expect(page.locator('.result-failure-summary')).toContainText(
        'Unknown identifier missing_script_value',
    );
    await page.locator('.script-results-trigger').click();
    await page.getByRole('menuitemradio', { name: 'Statement 1: succeeded' }).click();
    await expect(
        page.getByRole('region', { name: 'Query results', exact: true }).locator('tbody'),
    ).toContainText('first;value');
});

test('Cancelling a Playground script prevents later requests', async ({ page }) => {
    const gate = deferred();
    const requests: string[] = [];
    await mockPlayground(page, async sql => {
        requests.push(sql);
        await gate.promise;
        return rows('first;value');
    });
    try {
        await page.goto('/?connection=playground');
        await replaceSql(page, script);
        await page.getByTestId('run-button').click();
        await expect.poll(() => requests.length).toBe(1);
        await expect(page.getByTestId('run-button')).toHaveText('Cancel');
        await page.getByTestId('run-button').click();
        await expect.poll(async () => (await storedScript(page))?.status).toBe('cancelled');
        gate.resolve();
        expect(requests).toHaveLength(1);
        const stored = await storedScript(page);
        expect(stored?.statements).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ status: 'cancelled' }),
                expect.objectContaining({ status: 'skipped' }),
            ]),
        );
    } finally {
        gate.resolve();
    }
});

test('Reloading a running Playground script interrupts it without running pending queries', async ({
    page,
}) => {
    const gate = deferred();
    const requests: string[] = [];
    await mockPlayground(page, async sql => {
        requests.push(sql);
        await gate.promise;
        return rows('first;value');
    });
    try {
        await page.goto('/?connection=playground');
        await replaceSql(page, script);
        await page.getByTestId('run-button').click();
        await expect.poll(() => requests.length).toBe(1);
        await page.reload();
        await expect.poll(async () => (await storedScript(page))?.status).toBe('interrupted');
        gate.resolve();
        expect(requests).toHaveLength(1);
        await expect(page.getByTestId('run-button')).toHaveText('Run');
    } finally {
        gate.resolve();
    }
});

test('Choosing Stay in a navigation confirmation keeps the Playground script running', async ({
    page,
}) => {
    const gate = deferred();
    const requests: string[] = [];
    await mockPlayground(page, async sql => {
        requests.push(sql);
        if (requests.length === 1) await gate.promise;
        return rows(String(requests.length));
    });
    try {
        await page.goto('/?connection=playground');
        await replaceSql(page, script);
        await page.getByTestId('run-button').click();
        await expect.poll(() => requests.length).toBe(1);
        await page.evaluate(() =>
            window.addEventListener('beforeunload', event => {
                event.preventDefault();
                event.returnValue = '';
            }),
        );
        const dialog = page.waitForEvent('dialog');
        const navigation = page
            .reload({ waitUntil: 'commit', timeout: 2_000 })
            .catch(() => undefined);
        const confirmation = await dialog;
        expect(confirmation.type()).toBe('beforeunload');
        await confirmation.dismiss();
        await navigation;
        expect((await storedScript(page))?.status).toBe('running');
        expect(requests).toHaveLength(1);
        gate.resolve();
        await expect.poll(async () => (await storedScript(page))?.status).toBe('succeeded');
        expect(requests).toHaveLength(3);
    } finally {
        gate.resolve();
    }
});

for (const failSecond of [false, true]) {
    test(`The shared browser runner preserves Cloud script ${failSecond ? 'failure' : 'success'} behavior`, async ({
        page,
    }) => {
        const requests: Record<string, unknown>[] = [];
        const gate = deferred();
        await mockPlayground(page, async () => rows('unused'));
        await mockCloudEndpoint(page);
        await page.route('**/api/cloud', async route => {
            const body = jsonRecord(route.request().postDataJSON());
            if (body.action !== 'run') return route.fallback();
            requests.push(body);
            if (requests.length === 1) await gate.promise;
            if (failSecond && requests.length === 2) {
                await route.fulfill({
                    status: 400,
                    json: {
                        error: {
                            code: 'CLICKHOUSE_47',
                            message: 'Unknown identifier missing_script_value',
                        },
                    },
                });
                return;
            }
            await route.fulfill({
                json: {
                    queryId: body.queryId,
                    columns: [{ name: 'step', type: 'String' }],
                    rows: [[String(requests.length)]],
                    elapsedMs: 1,
                    bytes: 1,
                    truncated: false,
                },
            });
        });
        try {
            await connectPreviewCloud(page);
            await replaceSql(page, script);
            await page.getByTestId('run-button').click();
            await expect.poll(() => requests.length).toBe(1);
            expect(requests).toHaveLength(1);
            gate.resolve();
            await expect
                .poll(async () => (await storedScript(page, 'clickhouse-cloud'))?.status)
                .toBe(failSecond ? 'partial' : 'succeeded');
            const stored = await storedScript(page, 'clickhouse-cloud');
            expect(requests).toHaveLength(failSecond ? 2 : 3);
            expect(requests.every(request => request.sessionId === stored?.id)).toBe(true);
            expect(stored?.statements).toEqual([
                expect.objectContaining({ status: 'succeeded' }),
                expect.objectContaining({ status: failSecond ? 'failed' : 'succeeded' }),
                expect.objectContaining({ status: failSecond ? 'skipped' : 'succeeded' }),
            ]);
        } finally {
            gate.resolve();
        }
    });
}
