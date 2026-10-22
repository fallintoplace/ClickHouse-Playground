import { test, expect, type Page } from '@playwright/test';
import { isQueryDocument } from '../../src/shared/queries/saved-queries/validation.js';
import { decodeValue, jsonRecord } from '../helpers/type-guards.js';
import { replaceSql, runButton, trust } from './helpers.js';

const draftId = 'recovered-query';
const documentId = 'missing-saved-query';
const runId = 'missing-selected-run';
const workspaceKey = 'clickstudio:workspace:demo:v1';
const sql = 'SELECT 42 AS preserved_query';

declare global {
    interface Window {
        setWorkspaceStorageBlocked: (blocked: boolean) => void;
    }
}

async function blockWorkspaceStorage(page: Page) {
    await page.addInitScript(() => {
        let blocked = true;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
            if (blocked && key === 'clickstudio:workspace:demo:v1')
                throw new DOMException('Storage is full', 'QuotaExceededError');
            setItem.call(this, key, value);
        };
        window.setWorkspaceStorageBlocked = value => {
            blocked = value;
        };
    });
}

async function restoreDraft(page: Page, query = sql) {
    await page.addInitScript(
        ({ draftId, documentId, runId, workspaceKey, query }) => {
            if (sessionStorage.getItem('clickstudio:recovery-seeded')) return;
            localStorage.setItem(
                workspaceKey,
                JSON.stringify({
                    version: 1,
                    activeId: draftId,
                    tabs: [
                        {
                            id: draftId,
                            name: 'Recovered query.sql',
                            sql: query,
                            serverId: documentId,
                            baseRevision: 3,
                            parameters: {},
                            chart: { kind: 'table', x: 0, ys: [], title: 'Query result' },
                            activeRunId: runId,
                            runIds: [runId],
                            checkpoints: [],
                            from: 0,
                            to: 0,
                            kind: 'query',
                            dependencies: [],
                        },
                    ],
                }),
            );
            sessionStorage.setItem('clickstudio:recovery-seeded', 'true');
        },
        { draftId, documentId, runId, workspaceKey, query },
    );
}

async function storedDraft(page: Page) {
    const workspace = jsonRecord(
        await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), workspaceKey),
    );
    if (!Array.isArray(workspace.tabs)) throw new Error('Missing restored tabs');
    return jsonRecord(workspace.tabs.find(value => jsonRecord(value).id === draftId));
}

function missingRecord(message: string) {
    return { status: 404, json: { error: { code: 'NOT_FOUND', message } } };
}

async function missingRun(page: Page) {
    await page.route(`**/api/runs/${runId}`, route =>
        route.fulfill(missingRecord('Run not found')),
    );
}

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} lets me dismiss a browser draft-storage warning`, async ({ page }) => {
        await blockWorkspaceStorage(page);
        await trust(page, mode);
        const warning = page
            .getByRole('alert')
            .filter({ hasText: 'Drafts aren’t being saved in this browser.' });
        await expect(warning).toBeVisible();
        await warning.getByRole('button', { name: 'Dismiss error' }).click();
        await expect(warning).toHaveCount(0);
        await page.getByRole('button', { name: 'Help', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Explore ClickHouse Playground' })).toBeVisible();
    });

    test(`${mode} hides the browser draft-storage warning after eight seconds`, async ({
        page,
    }) => {
        await blockWorkspaceStorage(page);
        await page.clock.install({ time: new Date('2026-10-11T10:00:00Z') });
        await trust(page, mode);
        await page.clock.runFor(200);
        const warning = page
            .getByRole('alert')
            .filter({ hasText: 'Drafts aren’t being saved in this browser.' });
        await expect(warning).toBeVisible();
        await page.mouse.move(0, 0);
        await page.clock.runFor(8100);
        await expect(warning).toHaveCount(0);
    });

    test(`${mode} shows the draft-storage warning again after storage recovers and fails`, async ({
        page,
    }) => {
        await blockWorkspaceStorage(page);
        await trust(page, mode);
        const warning = page
            .getByRole('alert')
            .filter({ hasText: 'Drafts aren’t being saved in this browser.' });
        await expect(warning).toBeVisible();
        await warning.getByRole('button', { name: 'Dismiss error' }).click();
        await expect(warning).toHaveCount(0);

        await page.evaluate(() => window.setWorkspaceStorageBlocked(false));
        await replaceSql(page, 'SELECT 44');
        await expect
            .poll(() => page.evaluate(key => Boolean(localStorage.getItem(key)), workspaceKey))
            .toBe(true);

        await page.evaluate(() => window.setWorkspaceStorageBlocked(true));
        await replaceSql(page, 'SELECT 45');
        await expect(warning).toBeVisible();
    });
}

for (const mode of ['Standard', 'Experimental']) {
    test(`${mode} runs a restored draft with missing saved references without losing its SQL`, async ({
        page,
    }) => {
        await restoreDraft(page);
        await missingRun(page);
        let documentReads = 0;
        await page.route(`**/api/documents/${documentId}`, route => {
            documentReads++;
            return route.fulfill(missingRecord('Document not found'));
        });
        const submissions: Record<string, unknown>[] = [];
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
                submissions.push(jsonRecord(request.postDataJSON()));
        });

        await trust(page, mode);
        await expect(page.locator('.cm-content')).toHaveText(sql);
        await expect.poll(async () => (await storedDraft(page)).activeRunId).toBeUndefined();
        expect(submissions).toHaveLength(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await runButton(page).click();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        expect(documentReads).toBe(1);
        expect(submissions).toHaveLength(1);
        expect(submissions[0]).toMatchObject({ sql, connectionId: 'demo' });
        expect(submissions[0]?.documentId).toBeUndefined();
        const saved = await storedDraft(page);
        expect(saved).toMatchObject({ sql, serverId: documentId, baseRevision: 3 });
        expect(saved.runIds).toContain(runId);
        await page.reload();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        await expect(page.locator('.cm-content')).toHaveText(sql);
        expect(submissions).toHaveLength(1);
    });
}

test('A script can run from a draft whose saved document is missing', async ({ page }) => {
    const script = 'SELECT 1;\nSELECT 2;';
    await restoreDraft(page, script);
    await missingRun(page);
    await page.route(`**/api/documents/${documentId}`, route =>
        route.fulfill(missingRecord('Document not found')),
    );
    await trust(page);
    const submitted = page.waitForRequest(
        request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/scripts',
    );
    await runButton(page).click();
    const payload = jsonRecord((await submitted).postDataJSON());
    expect(payload.sql).toBe(script);
    expect(payload.documentId).toBeUndefined();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    expect(await storedDraft(page)).toMatchObject({ sql: script, serverId: documentId });
});

for (const failure of [
    { status: 403, code: 'FORBIDDEN', message: 'This saved document belongs to another user' },
    { status: 503, code: 'UNAVAILABLE', message: 'Saved documents are temporarily unavailable' },
    { status: 404, code: 'OTHER_NOT_FOUND', message: 'Another resource was not found' },
]) {
    test(`Saved document ${failure.code} does not submit SQL or remove its saved reference`, async ({
        page,
    }) => {
        await restoreDraft(page);
        await missingRun(page);
        await page.route(`**/api/documents/${documentId}`, route =>
            route.fulfill({
                status: failure.status,
                json: { error: { code: failure.code, message: failure.message } },
            }),
        );
        let submissions = 0;
        page.on('request', request => {
            if (
                request.method() === 'POST' &&
                ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
            )
                submissions++;
        });
        await trust(page);
        await runButton(page).click();
        await expect(page.getByRole('region', { name: 'Query results' })).toContainText(
            failure.message,
        );
        expect(submissions).toBe(0);
        expect(await storedDraft(page)).toMatchObject({
            sql,
            serverId: documentId,
            baseRevision: 3,
        });
    });
}

test('Temporary status failures keep the selected run and Retry clears a confirmed missing run', async ({
    page,
}) => {
    await restoreDraft(page);
    let unavailable = true;
    await page.route(`**/api/runs/${runId}`, route =>
        route.fulfill(
            unavailable
                ? {
                      status: 503,
                      json: { error: { code: 'UNAVAILABLE', message: 'Try again later' } },
                  }
                : missingRecord('Run not found'),
        ),
    );
    await trust(page);
    const notice = page.getByRole('alert').filter({ hasText: 'Couldn’t load the query status.' });
    await expect(notice).toBeVisible();
    expect((await storedDraft(page)).activeRunId).toBe(runId);
    unavailable = false;
    await notice.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(async () => (await storedDraft(page)).activeRunId).toBeUndefined();
    await expect(notice).toHaveCount(0);
    await expect(page.locator('.cm-content')).toHaveText(sql);
    expect((await storedDraft(page)).runIds).toContain(runId);
});

test('Running a saved query keeps its valid document association', async ({ page }) => {
    await trust(page);
    const savedResponse = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    const saved = decodeValue(await (await savedResponse).json(), isQueryDocument);
    const submitted = page.waitForRequest(
        request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    expect(jsonRecord((await submitted).postDataJSON()).documentId).toBe(saved.id);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
});

test('An open query can run after its saved document is moved to Trash', async ({ page }) => {
    await trust(page);
    const savedResponse = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    const saved = decodeValue(await (await savedResponse).json(), isQueryDocument);
    const trashed = await page.request.delete(`/api/documents/${saved.id}`, {
        headers: { 'X-ClickHouse Playground-Intent': '1' },
        data: { confirmImpact: true },
    });
    expect(trashed.ok()).toBe(true);
    const submitted = page.waitForRequest(
        request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    expect(jsonRecord((await submitted).postDataJSON()).documentId).toBeUndefined();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    // Workspace persistence runs after the React update. Verify that the
    // document association is eventually stored, not that it is synchronous.
    await expect
        .poll(async () => {
            const savedWorkspace = await page.evaluate(
                key => JSON.parse(localStorage.getItem(key) ?? 'null'),
                workspaceKey,
            );
            return jsonRecord(savedWorkspace).tabs;
        })
        .toEqual(expect.arrayContaining([expect.objectContaining({ serverId: saved.id })]));
});
