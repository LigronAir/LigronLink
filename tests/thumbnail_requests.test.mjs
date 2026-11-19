import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/index.js";
import { createUserSession } from "../src/security/sessions.js";
import { THUMBNAIL_POLICY } from "../src/thumbnails/policy.js";

const path = "/api/v1/thumbnails/requests";
const pi = (device_uuid = "pi") => ({ kind: "pi", device_uuid });
const box = (source_id = 1, device_uuid = "native") => ({ kind: "native_box", device_uuid, source_id });

async function fixture(t) {
    const sqlite = new DatabaseSync(":memory:");
    t.after(() => sqlite.close());
    sqlite.exec(`
        CREATE TABLE usuarios (
            id INTEGER PRIMARY KEY, uuid TEXT, nombre TEXT, email TEXT, estado TEXT
        );
        CREATE TABLE equipos (uuid TEXT PRIMARY KEY, usuario_id INTEGER, tipo TEXT, estado TEXT);
        INSERT INTO usuarios (id, estado) VALUES (1, 'ACTIVO'), (2, 'ACTIVO');
        INSERT INTO equipos VALUES
            ('pi', 1, 'LigronPi Native', 'ONLINE'), ('native', 1, 'LigronAir_Native', 'ONLINE'),
            ('other', 2, 'LigronPi', 'ONLINE'), ('unknown', 1, 'unsupported', 'ONLINE'),
            ('other-native', 2, 'LigronAir', 'ONLINE');
    `);
    for (const file of ["create_auth_sessions.sql", "create_equipos.sql", "migrations/0003_thumbnail_requests.sql"]) {
        sqlite.exec(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    }
    sqlite.exec(`
        INSERT INTO srt_destinos (usuario_id, equipo_uuid, source_id, nombre, host, port, estado,
            reservado_por_uuid, ultima_actualizacion, fecha_creacion) VALUES
            (1, 'native', 1, 'Caja 1', 'local', 9001, 'BUSY', 'pi', '', ''),
            (1, 'native', 2, 'Caja 2', 'local', 9002, 'BUSY', NULL, '', ''),
            (1, 'native', 3, 'Caja 3', 'local', 9003, 'FREE', 'pi', '', ''),
            (2, 'other-native', 1, 'Caja 1', 'local', 9001, 'BUSY', 'pi', '', ''),
            (2, 'native', 4, 'Caja 4', 'local', 9004, 'BUSY', 'pi', '', '');
    `);
    const DB = {
        prepare(sql) {
            const statement = sqlite.prepare(sql.replace(/\?(\d+)/g, ":p$1"));
            return {
                bind(...values) {
                    const params = Object.fromEntries(values.map((value, index) => [`p${index + 1}`, value]));
                    return {
                        query: () => statement.columns().length
                            ? { results: statement.all(params) }
                            : { meta: statement.run(params) },
                        first: async () => statement.get(params) ?? null,
                        run: async () => statement.run(params),
                    };
                },
            };
        },
        async batch(statements) {
            sqlite.exec("BEGIN");
            try {
                const results = statements.map(statement => statement.query());
                sqlite.exec("COMMIT");
                return results;
            } catch (error) {
                sqlite.exec("ROLLBACK");
                throw error;
            }
        },
    };
    const owner = (await createUserSession(DB, 1)).token;
    const other = (await createUserSession(DB, 2)).token;
    const env = { DB, THUMBNAILS_ENABLED: "true" };
    function call(method, { batch, token = owner, key = "refresh", targets, body } = {}) {
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (method === "POST") {
            if (key) headers["Idempotency-Key"] = key;
            headers["Content-Type"] = "application/json";
            body ??= JSON.stringify({ targets });
        }
        return worker.fetch(new Request(`https://api.ligronair.tv${path}${batch ? "/" + batch : ""}`, {
            method, headers, body,
        }), env);
    }
    return { call, env, sqlite, other };
}

test("thumbnail routes respect the feature flag and require an active Bearer session", async t => {
    const { call, env, sqlite } = await fixture(t);
    env.THUMBNAILS_ENABLED = "false";
    assert.equal((await call("POST", { targets: [pi()] })).status, 503);
    assert.equal((await call("GET", { batch: crypto.randomUUID() })).status, 503);
    assert.match((await call("OPTIONS")).headers.get("Access-Control-Allow-Headers"), /Idempotency-Key/i);
    env.THUMBNAILS_ENABLED = "true";
    assert.equal((await call("POST", { token: null, targets: [pi()] })).status, 401);
    assert.equal((await call("GET", { token: "x".repeat(40), batch: crypto.randomUUID() })).status, 401);
    sqlite.exec("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE usuario_id = 1");
    assert.equal((await call("POST", { targets: [pi()] })).status, 401);
});

test("creates capture metadata atomically and scopes catalog and batch lookup to the account", async t => {
    const { call, sqlite, other } = await fixture(t);
    for (const targets of [
        [pi(), pi("other")], [pi("unknown")], [pi("missing")], [box(3)],
        [box(1, "other-native")], [box(4)], [pi("native")],
    ]) {
        assert.equal((await call("POST", { targets })).status, 404);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM thumbnail_requests").get().n, 0);
    const created = await call("POST", { targets: [pi(), box(), box(2)] });
    assert.equal(created.status, 202);
    assert.equal(created.headers.get("Cache-Control"), "no-store");
    const batch = await created.json();
    assert.equal(batch.status, "PENDING");
    const [linked, external, piPreview] = batch.captures;
    assert.ok(linked.capture_id);
    assert.notEqual(linked.capture_id, external.capture_id);
    const pendingBox = {
        producer: "native_box", producer_device_uuid: "native",
        state: "PENDING", generation: null, deadline_ms: Date.parse(batch.expires_at),
    };
    assert.deepEqual(linked, {
        ...pendingBox, source_id: 1, source_device_uuid: "pi", capture_id: linked.capture_id,
    });
    assert.deepEqual(external, {
        ...pendingBox, source_id: 2, source_device_uuid: null, capture_id: external.capture_id,
    });
    assert.deepEqual(piPreview, {
        producer: "pi_preview", producer_device_uuid: "pi", source_id: null, source_device_uuid: "pi",
        state: "PENDING", generation: `pi:${piPreview.capture_id}`,
        deadline_ms: Date.parse(batch.expires_at), capture_id: piPreview.capture_id,
    });
    assert.deepEqual(batch.targets, [
        { ...box(), capture_id: linked.capture_id },
        { ...box(2), capture_id: external.capture_id },
        { ...pi(), capture_id: piPreview.capture_id },
    ]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM thumbnail_captures").get().n, 3);
    sqlite.exec("UPDATE srt_destinos SET estado = 'FREE' WHERE usuario_id = 1");
    assert.deepEqual(await (await call("GET", { batch: batch.batch_id })).json(), batch);
    const foreign = await call("GET", { token: other, batch: batch.batch_id });
    const missing = await call("GET", { token: other, batch: crypto.randomUUID() });
    assert.equal(foreign.status, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
    assert.equal((await call("POST", { token: other, targets: [pi("other")] })).status, 202);
    assert.equal((await call("POST", { key: "invalid", targets: [pi("other")] })).status, 404);
});

test("uses the Pi preview when no online Native has its BUSY reservation", async t => {
    const { call, sqlite } = await fixture(t);
    sqlite.exec("UPDATE equipos SET estado = 'OFFLINE' WHERE uuid = 'native'");
    const response = await call("POST", { targets: [pi()] });
    assert.equal(response.status, 202);
    const batch = await response.json();
    const capture_id = batch.targets[0].capture_id;
    assert.ok(capture_id);
    assert.deepEqual(batch.captures, [
        {
            capture_id, producer: "pi_preview", producer_device_uuid: "pi", source_id: null,
            source_device_uuid: "pi", state: "PENDING", generation: `pi:${capture_id}`,
            deadline_ms: Date.parse(batch.expires_at),
        },
    ]);
});

test("deduplicates retries, rejects conflicting keys and limits concurrent refreshes per account", async t => {
    const { call, sqlite } = await fixture(t);
    const responses = await Promise.all([
        call("POST", { targets: [pi(), box()] }),
        call("POST", { targets: [box(), pi()] }),
    ]);
    const [retry, first] = responses.sort((a, b) => a.status - b.status);
    assert.deepEqual([retry.status, first.status], [200, 202]);
    const competitor = await call("POST", { key: "different", targets: [pi()] });
    assert.equal(competitor.status, 429);
    assert.ok(Number(competitor.headers.get("Retry-After")) > 0);
    const batch = await first.json();
    assert.deepEqual(await retry.json(), batch);
    assert.equal((await call("POST", { targets: [pi()] })).status, 409);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM thumbnail_requests").get().n, 1);

    const expired = Date.now() - 1;
    sqlite.prepare("UPDATE thumbnail_requests SET created_at_ms = ?, expires_at_ms = ?")
        .run(expired - THUMBNAIL_POLICY.requestLifetimeMs, expired);
    sqlite.prepare("UPDATE thumbnail_captures SET deadline_at = ?").run(expired);
    const expiredBatch = await (await call("GET", { batch: batch.batch_id })).json();
    assert.equal(expiredBatch.status, "EXPIRED");
    assert.ok(expiredBatch.captures.every(capture => capture.state === "EXPIRED"));
    assert.deepEqual(expiredBatch.targets, batch.targets);
    const expiredRetry = await call("POST", { targets: [pi(), box()] });
    assert.equal(expiredRetry.status, 200);
    assert.equal((await expiredRetry.json()).batch_id, batch.batch_id);
    const competingRefreshes = await Promise.all([
        call("POST", { key: "different", targets: [pi()] }),
        call("POST", { key: "another", targets: [box()] }),
    ]);
    assert.deepEqual(competingRefreshes.map(response => response.status).sort(), [202, 429]);
});

test("GET expires only overdue pending captures belonging to the session account", async t => {
    const { call, sqlite, other } = await fixture(t);
    const batch = await (await call("POST", { targets: [pi(), box(2)] })).json();
    const [overdue, pending] = batch.captures;
    sqlite.prepare("UPDATE thumbnail_captures SET deadline_at = ? WHERE capture_id = ?")
        .run(Date.now() - 1, overdue.capture_id);
    assert.equal((await call("GET", { batch: batch.batch_id, token: other })).status, 404);
    const state = sqlite.prepare("SELECT state FROM thumbnail_captures WHERE capture_id = ?");
    assert.equal(state.get(overdue.capture_id).state, "PENDING");
    const updated = await (await call("GET", { batch: batch.batch_id })).json();
    assert.equal(updated.status, "PENDING");
    assert.deepEqual(updated.captures.map(capture => [capture.capture_id, capture.state]), [
        [overdue.capture_id, "EXPIRED"], [pending.capture_id, "PENDING"],
    ]);
});

test("rolls back the batch when capture insertion fails", async t => {
    const { call, sqlite } = await fixture(t);
    sqlite.exec(`
        CREATE TRIGGER reject_native_capture BEFORE INSERT ON thumbnail_captures
        WHEN NEW.producer_device_uuid = 'native'
        BEGIN
            SELECT RAISE(ABORT, 'injected capture failure');
        END;
    `);
    assert.equal((await call("POST", { targets: [box(), pi()] })).status, 500);
    for (const table of ["thumbnail_requests", "thumbnail_captures", "thumbnail_request_targets"]) {
        assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
    }
    sqlite.exec("DROP TRIGGER reject_native_capture");
    assert.equal((await call("POST", { targets: [box(), pi()] })).status, 202);
});

test("validates the idempotency key and accepts at most ten distinct targets", async t => {
    const { call, sqlite } = await fixture(t);
    const targets = Array.from({ length: 10 }, (_, i) => pi(`pi-${i}`));
    const insert = sqlite.prepare("INSERT INTO equipos VALUES (?, 1, 'LigronPi', 'ONLINE')");
    for (const target of targets) insert.run(target.device_uuid);

    for (const options of [
        { key: null, targets }, { key: "a b", targets }, { targets: [] },
        { targets: [pi(), pi()] }, { targets: [box(), box()] }, { targets: [42] },
        { targets: [...targets, pi()] }, { targets: [box("1")] },
        { body: JSON.stringify({ target_uuids: ["pi"] }) },
        { body: "{" }, { body: " ".repeat(8193) },
    ]) {
        assert.equal((await call("POST", options)).status, 400);
    }
    const created = await call("POST", { targets });
    assert.equal(created.status, 202);
    assert.equal((await created.json()).targets.length, 10);
});
