import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactService } from '../../.core-build/src/backend/queries/saved-queries/documents.js';
import { MonitorService } from '../../.core-build/src/backend/queries/monitoring/monitors.js';
import { isQueryDocument } from '../../.core-build/src/shared/queries/saved-queries/validation.js';
import { fixture, owner, other, until } from './helpers.mjs';
async function ready() {
    const f = fixture(),
        a = new ArtifactService(f.store, f.runs, f.authorize),
        r = f.runs.submit(owner, f.request());
    await f.runs.wait(owner, r.id);
    const doc = a.save(owner, {
        name: 'answer.sql',
        connectionId: 'local',
        sql: r.sql,
        runId: r.id,
    });
    return { ...f, a, r, doc };
}
test('Optimistic revisions cannot silently overwrite concurrent edits', async () => {
    const f = await ready();
    f.a.save(owner, { ...f.doc, baseRevision: 1, sql: 'SELECT 3' }, f.doc.id);
    assert.throws(() => f.a.save(owner, { ...f.doc, baseRevision: 1, sql: 'SELECT 4' }, f.doc.id), {
        code: 'REVISION_CONFLICT',
    });
});
test('Legacy chart types normalize to table and unknown types are rejected', async () => {
    const f = await ready();
    for (const kind of ['pie', 'area', 'stacked']) {
        const saved = f.a.save(owner, {
            name: 'legacy.sql',
            connectionId: 'local',
            sql: 'SELECT 1',
            chart: { kind, x: 0, ys: [0], title: 'Legacy' },
        });
        assert.equal(saved.chart.kind, 'table');
    }
    assert.throws(
        () =>
            f.a.save(owner, {
                name: 'invalid.sql',
                connectionId: 'local',
                sql: 'SELECT 1',
                chart: { kind: 'unknown', x: 0, ys: [0], title: 'Invalid' },
            }),
        { code: 'CHART_CONFIG' },
    );
    const stored = f.store.get('documents', f.doc.id, isQueryDocument);
    for (const kind of ['pie', 'area', 'stacked']) {
        stored.chart.kind = kind;
        f.store.put('documents', stored.id, stored);
        f.store.put('revisions', `${stored.id}-${stored.revision}`, stored);
        assert.equal(f.a.get(owner, stored.id).chart.kind, 'table');
        assert.equal(f.a.get(owner, stored.id, stored.revision).chart.kind, 'table');
        assert.equal(
            f.a.list(owner).find(document => document.id === stored.id).chart.kind,
            'table',
        );
        assert.equal(f.a.revisions(owner, stored.id)[0].chart.kind, 'table');
    }
    stored.chart.kind = 'unknown';
    f.store.put('revisions', `${stored.id}-${stored.revision}`, stored);
    assert.throws(() => f.a.get(owner, stored.id, stored.revision), {
        code: 'REVISION_NOT_FOUND',
    });
    assert.deepEqual(f.a.revisions(owner, stored.id), []);
    f.store.put('documents', stored.id, stored);
    assert.throws(() => f.a.get(owner, stored.id), { code: 'NOT_FOUND' });
    assert.equal(
        f.a.list(owner).some(document => document.id === stored.id),
        false,
    );
});
test('Persisted legacy documents can run while ownership and chart validation remain enforced', async t => {
    const f = await ready();
    t.after(() => f.runs.close());
    f.runs.trust(other, 'local', true);
    const stored = f.store.get('documents', f.doc.id, isQueryDocument);
    for (const kind of ['pie', 'area', 'stacked']) {
        stored.chart.kind = kind;
        f.store.put('documents', stored.id, stored);
        assert.equal(isQueryDocument(stored), false);
        const opened = f.a.get(owner, stored.id);
        assert.equal(opened.chart.kind, 'table');
        const run = f.runs.submit(owner, f.request({ documentId: opened.id, sql: opened.sql }));
        await f.runs.wait(owner, run.id);
        assert.equal(f.runs.get(owner, run.id).status, 'succeeded');
        assert.throws(() => f.a.get(other, stored.id), { code: 'NOT_FOUND' });
        assert.throws(() => f.runs.submit(other, f.request({ documentId: stored.id })), {
            code: 'NOT_FOUND',
        });
    }
    stored.chart.kind = 'unknown';
    f.store.put('documents', stored.id, stored);
    assert.throws(() => f.a.get(owner, stored.id), { code: 'NOT_FOUND' });
    assert.throws(() => f.runs.submit(owner, f.request({ documentId: stored.id })), {
        code: 'NOT_FOUND',
    });
});
test('All supported chart kinds survive saving and reading a document', async t => {
    const f = await ready();
    t.after(() => f.runs.close());
    for (const kind of [
        'table',
        'number',
        'line',
        'bar',
        'scatter',
        'heatmap',
        'candlestick',
        'geography',
    ]) {
        const document = f.a.save(owner, {
            name: `${kind}.sql`,
            connectionId: 'local',
            sql: 'SELECT 1',
            chart: {
                kind,
                x: 0,
                ys: [],
                title: 'Chart',
                ...(kind === 'candlestick' ? { candlestick: {} } : {}),
            },
        });
        assert.equal(document.chart.kind, kind);
        assert.equal(f.a.get(owner, document.id).chart.kind, kind);
        assert.equal(f.a.get(owner, document.id, 1).chart.kind, kind);
    }
});
test('Scatter and heatmap chart settings survive document saves and revision reads', async () => {
    const f = await ready();
    const configs = [
        { kind: 'scatter', x: 0, ys: [1], title: 'Fare by distance' },
        { kind: 'heatmap', x: 1, groupBy: 0, ys: [2], title: 'Trips by weekday and hour' },
    ];
    for (const [index, chart] of configs.entries()) {
        const document = f.a.save(owner, {
            name: `chart-${index}.sql`,
            connectionId: 'local',
            sql: 'SELECT 1',
            chart,
        });
        assert.deepEqual(document.chart, chart);
        assert.deepEqual(f.a.get(owner, document.id, 1).chart, chart);
        assert.deepEqual(f.a.revisions(owner, document.id)[0].chart, chart);
    }
});
test('Heatmap group-by metadata rejects negative, fractional, unsafe and out-of-range indexes', async () => {
    const f = await ready();
    for (const groupBy of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, 500, '0']) {
        assert.throws(
            () =>
                f.a.save(owner, {
                    name: `invalid-${String(groupBy)}.sql`,
                    connectionId: 'local',
                    sql: 'SELECT 1',
                    chart: { kind: 'heatmap', x: 1, groupBy, ys: [2], title: 'Invalid' },
                }),
            /groupBy must be an integer/,
        );
    }
    const withoutGroup = f.a.save(owner, {
        name: 'unconfigured-heatmap.sql',
        connectionId: 'local',
        sql: 'SELECT 1',
        chart: { kind: 'heatmap', x: 0, ys: [1], title: 'Configure axes in chart view' },
    });
    assert.equal(withoutGroup.chart.groupBy, undefined);
});
test('Restoring history creates a new draft without deleting query history', async () => {
    const f = await ready();
    f.a.save(owner, { ...f.doc, baseRevision: 1, sql: 'SELECT 3' }, f.doc.id);
    const restored = f.a.restoreRevision(owner, f.doc.id, 1, 2);
    assert.equal(restored.revision, 3);
    assert.equal(restored.sql, f.doc.sql);
    assert.equal(f.runs.list(owner).length, 1);
});
test('A published result remains immutable when the draft changes', async () => {
    const f = await ready(),
        p = f.a.publish(owner, f.doc.id, 1);
    f.a.save(owner, { ...f.doc, baseRevision: 1, sql: 'SELECT 3' }, f.doc.id);
    assert.equal(f.a.published(owner, p.id).document.sql, f.doc.sql);
    assert.equal(f.a.published(owner, p.id).revision, 1);
});
test('Stale SQL cannot borrow evidence from an earlier run', async () => {
    const f = await ready();
    f.a.save(owner, { ...f.doc, baseRevision: 1, sql: 'SELECT 9' }, f.doc.id);
    assert.throws(() => f.a.publish(owner, f.doc.id, 2), { code: 'STALE_EVIDENCE' });
});
test('Changing metric/query logic removes self-review approval', async () => {
    const f = await ready();
    f.a.review(owner, f.doc.id, 1);
    const d = f.a.save(owner, { ...f.doc, baseRevision: 1, sql: 'SELECT 9' }, f.doc.id);
    assert.equal(d.verifiedRevision, undefined);
});
test('Title-only change keeps logic review but increments revision', async () => {
    const f = await ready();
    f.a.review(owner, f.doc.id, 1);
    const d = f.a.save(owner, { ...f.doc, baseRevision: 1, name: 'renamed.sql' }, f.doc.id);
    assert.equal(d.verifiedRevision, 2);
});
test('Published shares are explicit bearer snapshots and revocable', async () => {
    const f = await ready(),
        p = f.a.publish(owner, f.doc.id, 1),
        share = f.a.share(owner, p.id);
    assert.equal(f.a.resolveShare(share.token).run.id, f.r.id);
    f.a.revokeShares(owner, p.id);
    assert.throws(() => f.a.resolveShare(share.token), { code: 'NOT_FOUND' });
});
test('Unrelated owners cannot access documents or create share links', async () => {
    const f = await ready(),
        p = f.a.publish(owner, f.doc.id, 1);
    assert.throws(() => f.a.get(other, f.doc.id), { code: 'NOT_FOUND' });
    assert.throws(() => f.a.share(other, p.id), { code: 'NOT_FOUND' });
});
test('Expired published snapshots do not become empty successful results', async () => {
    const f = await ready(),
        p = f.a.publish(owner, f.doc.id, 1);
    p.expiresAt = '2000-01-01T00:00:00Z';
    f.store.put('published', p.id, p);
    f.a.sweep();
    assert.throws(() => f.a.published(owner, p.id), { code: 'SNAPSHOT_EXPIRED' });
});
test('Expired publications release capacity and the same evidence can be republished', async () => {
    const f = await ready();
    for (let index = 0; index < 50; index++) {
        const document =
            index === 0
                ? f.doc
                : f.a.save(owner, {
                      name: `publication-${index}.sql`,
                      connectionId: 'local',
                      sql: f.r.sql,
                      runId: f.r.id,
                  });
        f.a.publish(owner, document.id, document.revision);
    }
    const blocked = f.a.save(owner, {
        name: 'blocked-publication.sql',
        connectionId: 'local',
        sql: f.r.sql,
        runId: f.r.id,
    });
    assert.throws(() => f.a.publish(owner, blocked.id, blocked.revision), {
        code: 'PUBLICATION_CAPACITY',
    });
    for (const publication of f.a.publications(owner)) {
        publication.expiresAt = '2000-01-01T00:00:00Z';
        f.store.put('published', publication.id, publication);
    }
    f.a.sweep();
    assert.equal(f.a.publications(owner).length, 0);
    const republished = f.a.publish(owner, f.doc.id, 1);
    assert.ok(Date.parse(republished.expiresAt) > Date.now());
    assert.equal(republished.result.rows.length, 2);
    assert.equal(f.a.publish(owner, blocked.id, blocked.revision).document.id, blocked.id);
});
test('Trash and restore preserve revisions', async () => {
    const f = await ready();
    f.a.trash(owner, f.doc.id);
    assert.equal(f.a.list(owner).length, 0);
    assert.equal(f.a.restore(owner, f.doc.id).revision, 1);
});
test('Trash frees active document capacity while restore respects the same limit', async () => {
    const f = await ready(),
        trashed = [f.doc];
    for (let index = 1; index < 200; index++)
        trashed.push(
            f.a.save(owner, {
                name: `trashed-${index}.sql`,
                connectionId: 'local',
                sql: 'SELECT 1',
            }),
        );
    for (const document of trashed) f.a.trash(owner, document.id, true);
    assert.equal(f.a.list(owner).length, 0);

    const active = [];
    for (let index = 0; index < 200; index++)
        active.push(
            f.a.save(owner, {
                name: `active-${index}.sql`,
                connectionId: 'local',
                sql: 'SELECT 1',
            }),
        );
    assert.throws(
        () => f.a.save(owner, { name: 'over-limit.sql', connectionId: 'local', sql: 'SELECT 1' }),
        { code: 'DOCUMENT_CAPACITY' },
    );
    assert.throws(() => f.a.restore(owner, trashed[0].id), { code: 'DOCUMENT_CAPACITY' });
    f.a.trash(owner, active[0].id, true);
    assert.equal(f.a.list(owner).length, 199);
    assert.equal(f.a.restore(owner, trashed[0].id).deletedAt, undefined);
    assert.equal(f.a.list(owner).length, 200);
});
test('Dependency impact blocks unacknowledged deletion', async () => {
    const f = await ready();
    f.a.save(owner, {
        name: 'child',
        connectionId: 'local',
        sql: 'SELECT 1',
        dependencies: [f.doc.id],
    });
    assert.throws(() => f.a.trash(owner, f.doc.id), { code: 'DOWNSTREAM_IMPACT' });
});
test('Dependency cycles are rejected', async () => {
    const f = await ready();
    const child = f.a.save(owner, {
        name: 'child',
        connectionId: 'local',
        sql: 'SELECT 1',
        dependencies: [f.doc.id],
    });
    assert.throws(
        () => f.a.save(owner, { ...f.doc, baseRevision: 1, dependencies: [child.id] }, f.doc.id),
        { code: 'DEPENDENCY_CYCLE' },
    );
});
test('Workspace exports use the ClickStudio format and imports never inherit source ownership, runs or approval', async () => {
    const f = await ready();
    f.a.review(owner, f.doc.id, 1);
    const bundle = f.a.export(owner);
    assert.equal(bundle.format, 'clickstudio-workspace');
    const imported = f.a.import(owner, bundle)[0];
    assert.notEqual(imported.id, f.doc.id);
    assert.equal(imported.runId, undefined);
    assert.equal(imported.verifiedRevision, undefined);
});
test('Comments attach to exact historical revision and bounded SQL range', async () => {
    const f = await ready();
    const c = f.a.comment(owner, f.doc.id, {
        revision: 1,
        text: 'Check grain',
        anchor: { from: 0, to: 6 },
    });
    assert.equal(c.revision, 1);
    assert.throws(() =>
        f.a.comment(owner, f.doc.id, {
            revision: 1,
            text: 'bad range',
            anchor: { from: 0, to: 9999 },
        }),
    );
});
test('Schedules can target only an existing published snapshot', async () => {
    const f = await ready(),
        m = new MonitorService(f.store, f.runs, f.a);
    assert.throws(() => m.create(owner, f.doc.id, 60, 'changed'), { code: 'NOT_FOUND' });
});
test('Unchanged monitor results stay quiet; every evaluation is a normal run', async () => {
    const f = await ready(),
        p = f.a.publish(owner, f.doc.id, 1),
        m = new MonitorService(f.store, f.runs, f.a),
        monitor = m.create(owner, p.id, 60, 'changed');
    await m.tick(Date.parse(monitor.nextAt) + 1);
    await until(() => m.list(owner)[0].lastHash);
    const current = m.list(owner)[0];
    await m.tick(Date.parse(current.nextAt) + 1);
    await until(() => f.runs.list(owner).filter(r => r.status === 'succeeded').length === 3);
    assert.equal(m.notices(owner).length, 0);
    assert.equal(f.calls.length, 3);
});
test('Revoked trust pauses due monitors and generates no database call', async () => {
    const f = await ready(),
        p = f.a.publish(owner, f.doc.id, 1),
        m = new MonitorService(f.store, f.runs, f.a),
        monitor = m.create(owner, p.id, 60, 'failure');
    f.runs.trust(owner, 'local', false);
    await m.tick(Date.parse(monitor.nextAt) + 1);
    assert.equal(m.list(owner)[0].paused, true);
    assert.equal(f.calls.length, 1);
    assert.equal(m.notices(owner).length, 1);
    assert.equal(m.notices(other).length, 0);
});
test('Invalid second imported document leaves the workspace unchanged', async () => {
    const f = await ready(),
        before = f.a.list(owner);
    assert.throws(() =>
        f.a.import(owner, {
            format: 'clickstudio-workspace',
            version: 1,
            documents: [
                { name: 'valid.sql', sql: 'SELECT 2', connectionId: 'local' },
                { name: 'invalid.sql', connectionId: 'local', sql: 42 },
            ],
        }),
    );
    assert.deepEqual(f.a.list(owner), before);
});

test('Geography settings survive saves, revision reads and switching chart types', async () => {
    const f = await ready();
    for (const source of [
        { mode: 'geometry', column: 1 },
        { mode: 'coordinates', longitude: 0, latitude: 1 },
    ]) {
        const geography = {
            source,
            sourceColumnNames:
                source.mode === 'geometry' ? ['location'] : ['longitude', 'latitude'],
            label: 2,
            measure: 3,
            swapCoordinates: true,
        };
        const saved = f.a.save(owner, {
            name: 'geography.sql',
            connectionId: 'local',
            sql: 'SELECT 1',
            chart: { kind: 'geography', x: 0, ys: [], title: 'Places', geography },
        });
        assert.equal(isQueryDocument(saved), true);
        assert.deepEqual(saved.chart.geography, geography);
        assert.notEqual(saved.chart.geography.source, source);
        assert.notEqual(saved.chart.geography.sourceColumnNames, geography.sourceColumnNames);
        assert.deepEqual(f.a.get(owner, saved.id, saved.revision).chart.geography, geography);
        const switched = f.a.save(
            owner,
            { ...saved, baseRevision: saved.revision, chart: { ...saved.chart, kind: 'bar' } },
            saved.id,
        );
        assert.deepEqual(switched.chart.geography, geography);
    }
});

test('Invalid geography settings cannot enter saved documents', async () => {
    const f = await ready();
    const source = { mode: 'coordinates', longitude: 0, latitude: 1 };
    const valid = { source, swapCoordinates: false };
    const invalid = [
        null,
        {},
        { ...valid, swapCoordinates: 'false' },
        ...[null, [], ['lon'], ['lon', 1], ['lon', 'lat', 'extra']].map(sourceColumnNames => ({
            ...valid,
            sourceColumnNames,
        })),
        ...[-1, 0.5, 500, NaN, Infinity].flatMap(index => [
            { ...valid, source: { mode: 'geometry', column: index } },
            { ...valid, label: index },
            { ...valid, measure: index },
        ]),
        { ...valid, source: { ...source, latitude: 0 } },
        { ...valid, source: { mode: 'other', column: 0 } },
    ];
    for (const geography of invalid)
        assert.throws(
            () =>
                f.a.save(owner, {
                    name: 'invalid.sql',
                    connectionId: 'local',
                    sql: 'SELECT 1',
                    chart: { kind: 'geography', x: 0, ys: [], title: 'Places', geography },
                }),
            { code: 'CHART_CONFIG' },
        );
});
