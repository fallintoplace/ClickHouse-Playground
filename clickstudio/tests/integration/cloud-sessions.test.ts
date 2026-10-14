import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CloudConnectionSessions,
    CLOUD_SESSION_COOKIE,
    CLOUD_SESSION_TTL_MS,
} from '../../src/backend/database/connections/cloud-sessions.js';

const credentials = {
    host: 'service.region.provider.clickhouse.cloud:8443',
    database: 'default',
    username: 'default',
    password: 'local-cloud-secret',
};
const tested = {
    host: credentials.host,
    database: credentials.database,
    username: credentials.username,
    serverVersion: '25.1.1',
};

test('Deleting the connected database switches only its live local Cloud session to default', () => {
    const sessions = new CloudConnectionSessions();
    const token = sessions.create(
        { ...credentials, database: 'analytics' },
        { ...tested, database: 'analytics' },
    );
    const cookie = `${CLOUD_SESSION_COOKIE}=${token}`;
    sessions.databaseDeleted('other', cookie);
    assert.equal(sessions.credentials(cookie)?.database, 'analytics');
    sessions.databaseDeleted('analytics', cookie);
    assert.equal(sessions.credentials(cookie)?.database, 'default');
    assert.equal(sessions.snapshot(cookie)?.tested.database, 'default');
    assert.equal(sessions.snapshot(cookie)?.profile.database, 'default');
    sessions.revoke(cookie);
    sessions.databaseDeleted('analytics', cookie);
    assert.equal(sessions.snapshot(cookie), undefined);
});

test('Local Cloud sessions keep credentials private and restore the tested connection profile', () => {
    const sessions = new CloudConnectionSessions(),
        token = sessions.create(credentials, tested);
    const cookie = `${CLOUD_SESSION_COOKIE}=${token}`;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(sessions.credentials(cookie), credentials);
    assert.deepEqual(sessions.snapshot(cookie), {
        profile: {
            host: credentials.host,
            database: credentials.database,
            username: credentials.username,
        },
        tested,
    });
    assert.equal(JSON.stringify(sessions.snapshot(cookie)).includes(credentials.password), false);
    assert.equal(sessions.snapshot(`${CLOUD_SESSION_COOKIE}=invalid`), undefined);
});

test('Local Cloud sessions refresh their idle expiry when used and expire after inactivity', () => {
    let now = 1_000;
    const sessions = new CloudConnectionSessions(() => now, 10, 1),
        token = sessions.create(credentials, tested);
    const cookie = `${CLOUD_SESSION_COOKIE}=${token}`;
    now = 1_009;
    assert.throws(() => sessions.create(credentials, tested), { code: 'CLOUD_SESSION_LIMIT' });
    assert.ok(sessions.credentials(cookie));
    now = 1_018;
    assert.ok(sessions.snapshot(cookie));
    now = 1_028;
    assert.equal(sessions.credentials(cookie), undefined);
    const replacement = sessions.create(credentials, tested);
    assert.deepEqual(sessions.credentials(`${CLOUD_SESSION_COOKIE}=${replacement}`), credentials);
});

test('Revoking a local Cloud session immediately removes its credentials', () => {
    const sessions = new CloudConnectionSessions(Date.now, CLOUD_SESSION_TTL_MS, 1),
        token = sessions.create(credentials, tested);
    const cookie = `${CLOUD_SESSION_COOKIE}=${token}`;
    sessions.revoke(`other=value; ${cookie}`);
    assert.equal(sessions.credentials(cookie), undefined);
    const replacement = sessions.create(credentials, tested);
    assert.deepEqual(sessions.credentials(`${CLOUD_SESSION_COOKIE}=${replacement}`), credentials);
});

test('Creating a local Cloud session frees expired capacity without a prior lookup', () => {
    let now = 1_000;
    const sessions = new CloudConnectionSessions(() => now, 10, 1);
    const expired = sessions.create(credentials, tested);
    now = 1_010;
    const replacement = sessions.create(credentials, tested);
    assert.equal(sessions.credentials(`${CLOUD_SESSION_COOKIE}=${expired}`), undefined);
    assert.deepEqual(sessions.credentials(`${CLOUD_SESSION_COOKIE}=${replacement}`), credentials);
});

test('Replacing a local Cloud session revokes only the matching previous browser session', () => {
    const sessions = new CloudConnectionSessions(),
        first = sessions.create(credentials, tested);
    const firstCookie = `${CLOUD_SESSION_COOKIE}=${first}`;
    const secondCredentials = {
        ...credentials,
        host: 'other.region.provider.clickhouse.cloud:8443',
    };
    const second = sessions.create(secondCredentials, tested, firstCookie);
    assert.equal(sessions.credentials(firstCookie), undefined);
    assert.deepEqual(sessions.credentials(`${CLOUD_SESSION_COOKIE}=${second}`), secondCredentials);
});
