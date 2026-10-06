// Route-level tests: the real Express app, on a real socket, against a real
// MongoDB. The unit tests cover the rules in isolation; these cover the wiring
// that joins validation, token spending, persistence and ranking, which is
// where the behaviour people actually hit is decided.
//
// Skips when no MongoDB is reachable so `npm test` still works offline. CI
// always has one, so they always run there.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const MONGO_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/space-dodger-routes-test';

// The limiters are built at import time, so raise them before requiring the
// app. One test lowers its expectations back to check limiting still happens.
process.env.WRITE_RATE_LIMIT = '10000';
process.env.READ_RATE_LIMIT = '10000';
process.env.MONGODB_URI = MONGO_URI;

let mongoose, server, baseUrl, Score, UsedToken, createToken, TOKEN_SECRET, available = false;

before(async () => {
    try {
        // mongoose resolves from backend/node_modules, so the app hands us its
        // own instance rather than the test requiring one that is not there
        const app = require('../backend/server.js');
        ({ Score, UsedToken, createToken, TOKEN_SECRET, mongoose } = app);
        await app.connectToDatabase(MONGO_URI);
        server = app.app.listen(0);
        await new Promise(r => server.once('listening', r));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        available = true;
    } catch (e) {
        // Skipping keeps `npm test` usable offline, but a silent skip in CI
        // would look exactly like a pass. CI sets this so a missing database
        // or backend dependency fails loudly instead.
        if (process.env.REQUIRE_ROUTE_TESTS === '1') {
            throw new Error(`route tests are required here but could not start: ${e.message}`);
        }
        console.log(`  (skipping route tests: ${e.message})`);
    }
});

after(async () => {
    if (!available) return;
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise(r => server.close(r));
});

beforeEach(async () => {
    if (!available) return;
    await Score.deleteMany({});
    await UsedToken.deleteMany({});
});

// Checked inside each test rather than as a skip option, because options are
// evaluated while the file is being read, before the before() hook has had a
// chance to discover whether a database is there.
const notReady = (t) => {
    if (!available) {
        t.skip('no MongoDB reachable');
        return true;
    }
    return false;
};

const post = (path, body) => fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
}).then(async r => ({ status: r.status, headers: r.headers, body: await r.json() }));

const get = (path) => fetch(baseUrl + path)
    .then(async r => ({ status: r.status, headers: r.headers, body: await r.json() }));

// A token that looks as if it were issued `ageMs` ago, so a plausible score
// can be submitted without the test waiting for real time to pass.
const agedToken = (ageMs = 10 * 60 * 1000) => createToken(TOKEN_SECRET, Date.now() - ageMs);

const submit = (overrides = {}) => post('/api/scores', {
    playerName: 'Vinh',
    score: 500,
    level: 5,
    sessionToken: agedToken(),
    ...overrides
});

describe('GET /health', () => {
    test('reports ok with a version while the database is up', async (t) => {
        if (notReady(t)) return;
        const res = await get('/health');
        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ok');
        assert.match(res.body.version, /^\d+\.\d+\.\d+$/);
    });
});

describe('POST /api/session', () => {
    test('issues a usable token', async (t) => {
        if (notReady(t)) return;
        const res = await post('/api/session', {});
        assert.equal(res.status, 201);
        assert.equal(res.body.success, true);
        assert.match(res.body.token, /^[\w-]+\.[0-9a-f]+$/);
    });

    test('issues a distinct token each time', async (t) => {
        if (notReady(t)) return;
        const a = (await post('/api/session', {})).body.token;
        const b = (await post('/api/session', {})).body.token;
        assert.notEqual(a, b);
    });
});

describe('POST /api/scores', () => {
    test('accepts a plausible submission and returns a rank', async (t) => {
        if (notReady(t)) return;
        const res = await submit();
        assert.equal(res.status, 201);
        assert.equal(res.body.rank, 1);
        assert.equal(res.body.score.playerName, 'Vinh');
        assert.equal(res.body.score.score, 500);
    });

    test('persists the row', async (t) => {
        if (notReady(t)) return;
        await submit();
        assert.equal(await Score.countDocuments({}), 1);
    });

    test('never returns internal fields', async (t) => {
        if (notReady(t)) return;
        const res = await submit();
        assert.deepEqual(
            Object.keys(res.body.score).sort(),
            ['level', 'playerName', 'score', 'timestamp']
        );
    });

    test('floors a fractional score before storing it', async (t) => {
        if (notReady(t)) return;
        const res = await submit({ score: 500.9, level: 5.9 });
        assert.equal(res.body.score.score, 500);
        assert.equal(res.body.score.level, 5);
    });

    test('strips html from the stored name', async (t) => {
        if (notReady(t)) return;
        const res = await submit({ playerName: '<script>Bad' });
        assert.equal(res.body.score.playerName, 'scriptBad');
    });

    test('rejects a name that reduces to nothing', async (t) => {
        if (notReady(t)) return;
        const res = await submit({ playerName: '<>&"' });
        assert.equal(res.status, 400);
        assert.match(res.body.error, /no usable characters/);
    });

    test('rejects a missing token', async (t) => {
        if (notReady(t)) return;
        const res = await post('/api/scores', { playerName: 'Vinh', score: 10, level: 1 });
        assert.equal(res.status, 400);
        assert.match(res.body.error, /session token/);
    });

    test('rejects a forged token', async (t) => {
        if (notReady(t)) return;
        const res = await submit({ sessionToken: 'bogus.deadbeef' });
        assert.equal(res.status, 400);
    });

    test('rejects a score the session is too young to justify', async (t) => {
        if (notReady(t)) return;
        const res = await post('/api/scores', {
            playerName: 'Cheat', score: 900000, level: 2, sessionToken: createToken(TOKEN_SECRET)
        });
        assert.equal(res.status, 400);
        assert.match(res.body.error, /not plausible/);
    });

    test('spends the token, so a replay is refused', async (t) => {
        if (notReady(t)) return;
        const sessionToken = agedToken();
        assert.equal((await submit({ sessionToken })).status, 201);

        const replay = await submit({ sessionToken, playerName: 'Replay' });
        assert.equal(replay.status, 409);
        assert.equal(await Score.countDocuments({}), 1, 'the replay must not have been stored');
    });

    test('a rejected submission does not burn the token', async (t) => {
        if (notReady(t)) return;
        const sessionToken = agedToken();
        assert.equal((await submit({ sessionToken, score: 999999 })).status, 400);
        assert.equal((await submit({ sessionToken, score: 100 })).status, 201);
    });

    test('rejects a body over the 2kb cap', async (t) => {
        if (notReady(t)) return;
        const res = await fetch(baseUrl + '/api/scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName: 'x'.repeat(5000), score: 1, level: 1 })
        });
        assert.equal(res.status, 413);
    });

    test('the rate limiter is wired, even with the cap raised for tests', async (t) => {
        if (notReady(t)) return;
        const res = await submit();
        assert.ok(res.headers.get('ratelimit-limit'), 'no RateLimit-Limit header, limiter is not running');
    });

    test('ranks tied scores by who got there first', async (t) => {
        if (notReady(t)) return;
        const a = await submit({ playerName: 'Alpha', score: 500 });
        const b = await submit({ playerName: 'Bravo', score: 500 });
        const c = await submit({ playerName: 'Charlie', score: 500 });
        assert.deepEqual([a.body.rank, b.body.rank, c.body.rank], [1, 2, 3]);
    });

    test('stores a valid player id and ignores a malformed one', async (t) => {
        if (notReady(t)) return;
        await submit({ playerName: 'WithId', playerId: 'a'.repeat(32) });
        await submit({ playerName: 'BadId', playerId: 'nope!' });

        assert.equal((await Score.findOne({ playerName: 'WithId' }).lean()).playerId, 'a'.repeat(32));
        assert.equal((await Score.findOne({ playerName: 'BadId' }).lean()).playerId, undefined);
    });
});

describe('GET /api/leaderboard', () => {
    test('returns an empty board before anyone plays', async (t) => {
        if (notReady(t)) return;
        const res = await get('/api/leaderboard');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.leaderboard, []);
        assert.equal(res.body.count, 0);
    });

    test('sorts by score descending, ties by who was first', async (t) => {
        if (notReady(t)) return;
        await submit({ playerName: 'Low', score: 100 });
        await submit({ playerName: 'TieFirst', score: 500 });
        await submit({ playerName: 'TieSecond', score: 500 });

        const names = (await get('/api/leaderboard')).body.leaderboard.map(e => e.playerName);
        assert.deepEqual(names, ['TieFirst', 'TieSecond', 'Low']);
    });

    test('honours a limit and clamps an absurd one', async (t) => {
        if (notReady(t)) return;
        await submit({ playerName: 'A', score: 300 });
        await submit({ playerName: 'B', score: 200 });

        assert.equal((await get('/api/leaderboard?limit=1')).body.leaderboard.length, 1);
        assert.equal((await get('/api/leaderboard?limit=99999')).body.leaderboard.length, 2);
    });

    test('never exposes player ids or internal fields', async (t) => {
        if (notReady(t)) return;
        // The id is what says "this run is mine"; handing it out would let
        // anyone submit as that player.
        await submit({ playerName: 'Vinh', playerId: 'b'.repeat(32) });
        const entry = (await get('/api/leaderboard')).body.leaderboard[0];
        assert.deepEqual(Object.keys(entry).sort(), ['level', 'playerName', 'score', 'timestamp']);
    });
});

describe('POST /api/player/best', () => {
    test('finds a player by id', async (t) => {
        if (notReady(t)) return;
        const playerId = 'c'.repeat(32);
        await submit({ playerName: 'Vinh', score: 300, playerId });
        await submit({ playerName: 'Vinh', score: 700, playerId });

        const res = await post('/api/player/best', { playerId });
        assert.equal(res.status, 200);
        assert.equal(res.body.score.score, 700, 'should return the best, not the latest');
        assert.equal(res.body.matchedBy, 'playerId');
        assert.equal(res.body.rank, 1);
    });

    test('tells two players with the same name apart', async (t) => {
        if (notReady(t)) return;
        // The reason identity exists at all.
        const mine = 'd'.repeat(32);
        const theirs = 'e'.repeat(32);
        await submit({ playerName: 'Vinh', score: 200, playerId: mine });
        await submit({ playerName: 'Vinh', score: 900, playerId: theirs });

        assert.equal((await post('/api/player/best', { playerId: mine })).body.score.score, 200);
        assert.equal((await post('/api/player/best', { playerId: theirs })).body.score.score, 900);
    });

    test('falls back to the name for runs recorded before ids existed', async (t) => {
        if (notReady(t)) return;
        await submit({ playerName: 'Legacy', score: 400 }); // no playerId

        const res = await post('/api/player/best', { playerId: 'f'.repeat(32), playerName: 'Legacy' });
        assert.equal(res.body.score.score, 400);
        assert.equal(res.body.matchedBy, 'playerName');
    });

    test('prefers the id over the name when both match different rows', async (t) => {
        if (notReady(t)) return;
        const playerId = '1'.repeat(32);
        await submit({ playerName: 'Someone Else', score: 150, playerId });
        await submit({ playerName: 'Vinh', score: 950 });

        const res = await post('/api/player/best', { playerId, playerName: 'Vinh' });
        assert.equal(res.body.score.score, 150, 'identity must win over display name');
        assert.equal(res.body.matchedBy, 'playerId');
    });

    test('normalizes the fallback name the same way writes do', async (t) => {
        if (notReady(t)) return;
        await submit({ playerName: '<script>Bad', score: 120 });
        const res = await post('/api/player/best', { playerName: '<script>Bad' });
        assert.equal(res.body.score.score, 120);
    });

    test('returns a null score for an unknown player', async (t) => {
        if (notReady(t)) return;
        const res = await post('/api/player/best', { playerId: '9'.repeat(32) });
        assert.equal(res.status, 200);
        assert.equal(res.body.score, null);
    });

    test('requires something to look up', async (t) => {
        if (notReady(t)) return;
        const res = await post('/api/player/best', {});
        assert.equal(res.status, 400);
    });

    test('agrees with the rank the submission reported', async (t) => {
        if (notReady(t)) return;
        const playerId = '2'.repeat(32);
        await submit({ playerName: 'Top', score: 800 });
        const mine = await submit({ playerName: 'Second', score: 400, playerId });

        const res = await post('/api/player/best', { playerId });
        assert.equal(res.body.rank, mine.body.rank);
        assert.equal(res.body.rank, 2);
    });
});

describe('GET /api/player/:playerName', () => {
    test('still works for clients deployed before the id endpoint', async (t) => {
        if (notReady(t)) return;
        await submit({ playerName: 'Vinh', score: 640 });
        const res = await get('/api/player/Vinh');
        assert.equal(res.status, 200);
        assert.equal(res.body.score.score, 640);
        assert.equal(res.body.rank, 1);
    });

    test('returns a null score for an unknown name', async (t) => {
        if (notReady(t)) return;
        const res = await get('/api/player/Nobody');
        assert.equal(res.body.score, null);
    });

    test('rejects a name with no usable characters', async (t) => {
        if (notReady(t)) return;
        const res = await get(`/api/player/${encodeURIComponent('<>&"')}`);
        assert.equal(res.status, 400);
    });
});
