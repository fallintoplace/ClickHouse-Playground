import test from 'node:test';
import assert from 'node:assert/strict';
import {
    loadConfig,
    publicProfile,
    redactor,
} from '../../.core-build/src/backend/system/config.js';
test('Bundled reader permits bounded previews without changing remote profiles', () => {
    const bundled = loadConfig({ CLICKHOUSE_USER: 'clickstudio_reader' });
    assert.equal(bundled.profiles[0].previewOverflowMode, 'break');
    assert.equal(bundled.profiles.find(p => p.publicPlayground)?.previewOverflowMode, undefined);

    const remote = loadConfig({
        CLICKHOUSE_USER: 'clickstudio_reader',
        CLICKHOUSE_URL: 'https://sql.example.com',
    });
    assert.equal(remote.profiles[0].previewOverflowMode, undefined);
    const optedIn = loadConfig({
        CLICKHOUSE_USER: 'reader',
        CLICKHOUSE_PREVIEW_OVERFLOW_MODE: 'break',
    });
    assert.equal(optedIn.profiles[0].previewOverflowMode, 'break');
    const optedOut = loadConfig({
        CLICKHOUSE_USER: 'clickstudio_reader',
        CLICKHOUSE_PREVIEW_OVERFLOW_MODE: 'throw',
    });
    assert.equal(optedOut.profiles[0].previewOverflowMode, undefined);
    assert.throws(() => loadConfig({ CLICKHOUSE_PREVIEW_OVERFLOW_MODE: 'truncate' }), {
        code: 'PREVIEW_OVERFLOW_MODE',
    });
});
test('Unbounded full CSV output is enabled only for compatible or opted-in readers', () => {
    const bundled = loadConfig({ CLICKHOUSE_USER: 'clickstudio_reader' });
    assert.equal(bundled.profiles[0].fullExportUnbounded, true);
    assert.equal(bundled.profiles.find(p => p.publicPlayground)?.fullExportUnbounded, undefined);

    const remote = loadConfig({
        CLICKHOUSE_USER: 'clickstudio_reader',
        CLICKHOUSE_URL: 'https://sql.example.com',
    });
    assert.equal(remote.profiles[0].fullExportUnbounded, undefined);
    const optedIn = loadConfig({
        CLICKHOUSE_USER: 'reader',
        CLICKHOUSE_FULL_EXPORT_UNBOUNDED: 'true',
    });
    assert.equal(optedIn.profiles[0].fullExportUnbounded, true);
    const optedOut = loadConfig({
        CLICKHOUSE_USER: 'clickstudio_reader',
        CLICKHOUSE_FULL_EXPORT_UNBOUNDED: 'false',
    });
    assert.equal(optedOut.profiles[0].fullExportUnbounded, undefined);
    assert.throws(() => loadConfig({ CLICKHOUSE_FULL_EXPORT_UNBOUNDED: 'maybe' }), {
        code: 'FULL_EXPORT_CONFIG',
    });
});
test('Local startup binds loopback by default', () =>
    assert.equal(loadConfig({}).host, '127.0.0.1'));
test('The assistant defaults to Luna Fast mode and accepts Standard processing', () => {
    for (const tier of [undefined, '', '  ', 'fast', 'priority', ' fast ', ' priority ']) {
        const config = loadConfig({ OPENAI_SERVICE_TIER: tier });
        assert.equal(config.openaiModel, 'gpt-6-luna');
        assert.equal(config.openaiServiceTier, 'priority');
    }
    assert.equal(loadConfig({ OPENAI_SERVICE_TIER: ' default ' }).openaiServiceTier, 'default');
    const config = loadConfig({ OPENAI_MODEL: 'custom-model', OPENAI_SERVICE_TIER: 'default' });
    assert.equal(config.openaiModel, 'custom-model');
    assert.equal(config.openaiServiceTier, 'default');
});
test('Unsupported assistant service tiers fail configuration validation', () => {
    for (const tier of ['standard', 'FAST', 'unknown', 'flex'])
        assert.throws(() => loadConfig({ OPENAI_SERVICE_TIER: tier }), {
            code: 'OPENAI_SERVICE_TIER',
        });
});
test('Local startup includes the public ClickHouse Playground with bounded read-only defaults', () => {
    const config = loadConfig({}),
        playground = config.profiles.find(profile => profile.publicPlayground);
    assert.deepEqual(
        {
            id: playground?.id,
            name: playground?.name,
            url: playground?.url,
            database: playground?.database,
            username: playground?.username,
        },
        {
            id: 'playground',
            name: 'ClickHouse Playground',
            url: 'https://sql-clickhouse.clickhouse.com:8443/',
            database: 'github',
            username: 'demo',
        },
    );
    assert.deepEqual(
        { rows: playground?.limits.rows, seconds: playground?.limits.seconds },
        { rows: 1000, seconds: 60 },
    );
    const connection = playground && publicProfile(playground);
    assert.equal(connection?.readonly, true);
    assert.equal(connection?.manifest?.import.available, false);
    assert.equal(connection?.manifest?.scripts.available, true);
    assert.equal(connection?.manifest?.parameters.available, false);
});
test('The public ClickHouse Playground is not added to a shared server', () => {
    const config = loadConfig({
        HOST: '0.0.0.0',
        CLICKSTUDIO_TOKEN: 'a'.repeat(32),
        CLICKHOUSE_USER: 'reader',
    });
    assert.ok(!config.profiles.some(profile => profile.id === 'playground'));
});
test('Fixture mode keeps its browser Playground instead of adding a server profile', () => {
    const config = loadConfig({ DEMO_MODE: 'true' });
    assert.ok(!config.profiles.some(profile => profile.id === 'playground'));
});
test('Non-loopback startup requires an owner access token', () =>
    assert.throws(() => loadConfig({ HOST: '0.0.0.0' }), { code: 'AUTH_REQUIRED' }));
test('A loopback bind with a public application origin requires an owner access token', () =>
    assert.throws(() => loadConfig({ HOST: '127.0.0.1', APP_ORIGIN: 'https://sql.example.com' }), {
        code: 'AUTH_REQUIRED',
    }));
test('A public application origin also requires a restricted ClickHouse identity', () =>
    assert.throws(
        () =>
            loadConfig({
                HOST: '127.0.0.1',
                APP_ORIGIN: 'https://sql.example.com',
                CLICKSTUDIO_TOKEN: 'a'.repeat(32),
            }),
        { code: 'RESTRICTED_IDENTITY' },
    ));
test('A loopback bind with a token and restricted identity supports an external application origin', () => {
    const config = loadConfig({
        HOST: '127.0.0.1',
        APP_ORIGIN: 'https://sql.example.com',
        CLICKSTUDIO_TOKEN: 'a'.repeat(32),
        CLICKHOUSE_USER: 'reader',
    });
    assert.equal(config.origin, 'https://sql.example.com');
});
test('Loopback IPv4 and IPv6 application origins remain local', () => {
    assert.equal(
        loadConfig({ HOST: '127.14.0.9', APP_ORIGIN: 'http://localhost:5173' }).host,
        '127.14.0.9',
    );
    assert.equal(loadConfig({ HOST: '::1', APP_ORIGIN: 'http://[::1]:5173' }).host, '::1');
});
test('Fixture mode remains local when a reverse proxy origin is configured', () =>
    assert.throws(
        () =>
            loadConfig({
                HOST: '127.0.0.1',
                APP_ORIGIN: 'https://sql.example.com',
                CLICKSTUDIO_TOKEN: 'a'.repeat(32),
                CLICKHOUSE_USER: 'reader',
                DEMO_MODE: 'true',
            }),
        { code: 'DEMO_LOCAL_ONLY' },
    ));
test('A shared binding cannot use the default ClickHouse identity', () =>
    assert.throws(() => loadConfig({ HOST: '0.0.0.0', CLICKSTUDIO_TOKEN: 'a'.repeat(40) }), {
        code: 'RESTRICTED_IDENTITY',
    }));
test('Fixture mode cannot be exposed on a shared bind address', () =>
    assert.throws(
        () =>
            loadConfig({
                HOST: '0.0.0.0',
                CLICKSTUDIO_TOKEN: 'a'.repeat(40),
                CLICKHOUSE_USER: 'reader',
                DEMO_MODE: 'true',
            }),
        { code: 'DEMO_LOCAL_ONLY' },
    ));
test('Connection URLs cannot carry credentials', () =>
    assert.throws(() => loadConfig({ CLICKHOUSE_URL: 'https://user:secret@example.com' }), {
        code: 'CONNECTION_URL',
    }));
test('Connection URLs cannot carry arbitrary paths', () =>
    assert.throws(() => loadConfig({ CLICKHOUSE_URL: 'http://localhost:8123/other-api' }), {
        code: 'CONNECTION_URL',
    }));
test('Public profiles omit read and write passwords', () => {
    const c = loadConfig({
        CLICKHOUSE_PASSWORD: 'reader-pass',
        CLICKHOUSE_WRITER_USER: 'writer',
        CLICKHOUSE_WRITER_PASSWORD: 'writer-pass',
    });
    const output = JSON.stringify(publicProfile(c.profiles[0]));
    assert.ok(!output.includes('reader-pass'));
    assert.ok(!output.includes('writer-pass'));
    assert.ok(!output.includes('writer'));
});
test('Configured secrets are redacted before diagnostic truncation', () => {
    const c = loadConfig({ CLICKHOUSE_PASSWORD: 'private-password' });
    const result = redactor(c)('x'.repeat(2995) + 'private-password');
    assert.ok(!result.includes('private'));
    assert.ok(result.length <= 3000);
});
test('The ClickHouse identity can write without target allowlist configuration', () => {
    const connectionIdentity = loadConfig({ CLICKHOUSE_USER: 'interview_user' }).profiles[0];
    assert.equal(connectionIdentity.writer, undefined);
    assert.equal(loadConfig({ CLICKHOUSE_WRITER_USER: 'writer' }).profiles[0].writer, undefined);
    const writer = loadConfig({
        CLICKHOUSE_WRITER_USER: 'writer',
        CLICKHOUSE_WRITER_PASSWORD: 'writer-pass',
    }).profiles[0].writer;
    assert.deepEqual(writer, { username: 'writer', password: 'writer-pass' });
});
test('Demo publications remain labeled fixtures outside the workspace', async () => {
    const { DemoDriver } =
        await import('../../.core-build/src/backend/database/clickhouse/sample-client.js');
    const { MemoryStore } = await import('../../.core-build/src/backend/system/store.js');
    const { RunService } = await import('../../.core-build/src/backend/queries/execution/runs.js');
    const { ArtifactService } =
        await import('../../.core-build/src/backend/queries/saved-queries/documents.js');
    const { randomUUID } = await import('node:crypto');
    const store = new MemoryStore(),
        driver = new DemoDriver(),
        owner = { id: 'local-owner', role: 'owner' },
        authorize = (p, id) => driver.connection(p, id);
    const runs = new RunService(store, driver, authorize),
        artifacts = new ArtifactService(store, runs, authorize);
    runs.trust(owner, 'demo', true);
    const run = runs.submit(owner, {
        clientRequestId: randomUUID(),
        connectionId: 'demo',
        sql: 'SELECT 1',
    });
    await runs.wait(owner, run.id);
    const doc = artifacts.save(owner, {
        name: 'fixture.sql',
        connectionId: 'demo',
        sql: 'SELECT 1',
        runId: run.id,
    });
    const pub = artifacts.publish(owner, doc.id, 1);
    assert.equal(pub.source, 'fixture');
    assert.equal(pub.run.dataSource, 'fixture');
    await runs.close();
});
