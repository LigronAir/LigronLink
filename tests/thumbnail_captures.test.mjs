import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { issueDeviceCredential } from "../src/security/deviceCredentials.js";
import { ThumbnailHub } from "../src/thumbnails/ThumbnailHub.js";
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
    for (const file of ["create_auth_sessions.sql", "create_device_credentials.sql", "create_equipos.sql", "migrations/0003_thumbnail_requests.sql"]) {
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
                        all: async () => ({ results: statement.all(params) }),
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

    const objects = new Map();
    const operations = [];
    env.THUMBNAILS = {
        async put(key, bytes) { operations.push("put"); objects.set(key, bytes.slice()); },
        async get(key) { operations.push("get"); return objects.has(key) ? new Response(objects.get(key)) : null; },
        async delete(key) { objects.delete(key); }
    };
    const hubSql = new DatabaseSync(":memory:");
    t.after(() => hubSql.close());
    const hub = new ThumbnailHub({
        blockConcurrencyWhile: fn => fn(),
        storage: { sql: { exec(query, ...args) { return hubSql.prepare(query).all(...args); } } }
    });
    env.THUMBNAIL_HUB = {
        getByName(account) {
            assert.equal(account, "1");
            return { async fetch(url, init) {
                operations.push(JSON.parse(init.body).operation);
                return hub.fetch(new Request(url, init));
            } };
        }
    };
    function quota(writes, reads) {
        hubSql.prepare("INSERT OR REPLACE INTO thumbnail_usage VALUES (?,?,?)")
            .run(new Date().toISOString().slice(0, 7), writes, reads);
    }
    const tokens = {};
    for (const uuid of ["pi", "native", "other"]) tokens[uuid] = await issueDeviceCredential(DB, uuid);
    const batch = await (await call("POST", { targets: [box()] })).json();
    const id = batch.captures[0].capture_id;
    function fetch(method, suffix, { uuid = "native", authorization = "Device " + tokens[uuid],
        body, headers } = {}) {
        const route = suffix === "pending" ? suffix : "captures/" + id + suffix;
        return worker.fetch(new Request("https://test/api/v1/thumbnails/" + route + "?device_uuid=" + uuid, {
            method, body, headers: { Authorization: authorization, "Content-Type": "image/jpeg",
                "X-Ligron-Assignment-Generation": "001", ...headers }
        }), env);
    }
    return { fetch, sqlite, env, operations, objects, owner, other, id, quota, call, tokens };
}
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==', 'base64');

test("device polling, authenticated upload and private account-scoped read", async t => {
    const { fetch, owner, other, sqlite, id, operations, objects } = await fixture(t);
    assert.equal((await fetch("GET", "pending", { authorization: "Device invalid" })).status, 401);
    assert.deepEqual((await (await fetch("GET", "pending", { uuid: "other" })).json()).captures, []);
    assert.deepEqual((await (await fetch("GET", "pending", { uuid: "pi" })).json()).captures, []);
    const [job] = (await (await fetch("GET", "pending")).json()).captures;
    assert.equal(job.capture_id, id);
    assert.ok(job.request_id);
    assert.equal((await fetch("PUT", "", { uuid: "other", body: jpeg })).status, 404);
    assert.equal((await fetch("PUT", "", { body: jpeg })).status, 200);
    assert.equal((await fetch("PUT", "", { body: jpeg })).status, 200);
    assert.equal(operations.filter(x => x === "put").length, 1);
    const sha = Buffer.from(await crypto.subtle.digest("SHA-256", jpeg)).toString("hex");
    assert.deepEqual([...objects.keys()], [`thumbnails/1/${id}/${sha}`]);
    const different = Buffer.from(jpeg);
    different[12] ^= 1;
    assert.equal((await fetch("PUT", "", { body: different })).status, 409);
    assert.equal(sqlite.prepare("SELECT generation FROM thumbnail_captures").get().generation, "001");
    assert.equal((await fetch("GET", "/image", { authorization: "Bearer " + other })).status, 404);
    const read = () => fetch("GET", "/image", { authorization: "Bearer " + owner });
    const image = await read();
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("Cache-Control"), "private, no-store");
    assert.equal(image.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
    objects.clear();
    assert.equal((await read()).status, 404);
    assert.equal(sqlite.prepare("SELECT state FROM thumbnail_captures").get().state, "FAILED");
});

test("quota and recovery after D1 rejects READY", async t => {
    const { fetch, env, sqlite, operations, owner, quota } = await fixture(t);
    const upload = () => fetch("PUT", "", { body: jpeg });
    quota(THUMBNAIL_POLICY.maxR2ClassAOperationsPerMonth, 0);
    assert.equal((await upload()).status, 429);
    assert.ok(!operations.includes("put"));
    quota(0, 0);
    sqlite.exec("CREATE TRIGGER fail BEFORE UPDATE OF state ON thumbnail_captures BEGIN SELECT RAISE(ABORT,'injected'); END");
    assert.equal((await upload()).status, 503);
    sqlite.exec("DROP TRIGGER fail");
    assert.equal((await upload()).status, 200);
    assert.equal(operations.filter(x => x === "put").length, 1);
    quota(0, THUMBNAIL_POLICY.maxR2ClassBOperationsPerMonth);
    assert.equal((await fetch("GET", "/image", { authorization: "Bearer " + owner })).status, 429);
});

for (const ready of [false, true]) test("assignment change invalidates " + (ready ? "read" : "upload"), async t => {
    const { fetch, sqlite, owner, operations } = await fixture(t);
    if (ready) assert.equal((await fetch("PUT", "", { body: jpeg })).status, 200);
    sqlite.exec("UPDATE srt_destinos SET reservado_por_uuid=NULL WHERE usuario_id=1");
    const response = ready ? await fetch("GET", "/image", { authorization: "Bearer " + owner })
        : await fetch("PUT", "", { body: jpeg });
    assert.equal(response.status, 409);
    assert.equal(sqlite.prepare("SELECT state FROM thumbnail_captures").get().state, "INVALIDATED");
    assert.ok(!operations.includes("get"));
});

test("expiry, late upload and revoked credentials", async t => {
    const { fetch, sqlite } = await fixture(t);
    sqlite.exec("UPDATE thumbnail_captures SET deadline_at=0");
    assert.deepEqual((await (await fetch("GET", "pending")).json()).captures, []);
    assert.equal((await fetch("PUT", "", { body: jpeg })).status, 409);
    sqlite.exec("UPDATE device_credentials SET revoked_at=datetime('now')");
    assert.equal((await fetch("PUT", "", { body: jpeg })).status, 401);
    assert.equal((await fetch("GET", "pending")).status, 401);
});

test("repeated producer failure must match the persisted code", async t => {
    const { fetch, sqlite } = await fixture(t);
    const failure = code => fetch("POST", "/failure", { body: JSON.stringify({ error_code: code }) });
    assert.equal((await failure("unexpected")).status, 400);
    assert.equal((await failure("NO_FRAME")).status, 200);
    assert.equal((await failure("NO_FRAME")).status, 409);
    assert.equal((await failure("UPLOAD_FAILED")).status, 409);
    assert.equal(sqlite.prepare("SELECT failure_code FROM thumbnail_captures").get().failure_code, "NO_FRAME");
});

test("checks JPEG dimensions, bounded stream, generation and storage availability", async t => {
    const { fetch, env, operations } = await fixture(t);
    const upload = (body, headers) => fetch("PUT", "", { body, headers });
    const oversized = Buffer.from(jpeg);
    oversized.writeUInt16BE(161, oversized.indexOf(Buffer.from([255, 192])) + 7);
    assert.equal((await upload(oversized)).status, 400);
    assert.equal((await upload(jpeg.subarray(0, -2))).status, 400);
    assert.equal((await upload(Buffer.alloc(16385))).status, 413);
    assert.equal((await upload(jpeg, { "Content-Length": "16385" })).status, 413);
    assert.equal((await upload(jpeg, { "Content-Type": "image/png" })).status, 415);
    assert.equal((await upload(jpeg, { "X-Ligron-Assignment-Generation": "x".repeat(129) })).status, 400);
    assert.deepEqual(operations, []);
    delete env.THUMBNAILS;
    assert.equal((await upload(jpeg)).status, 503);
    env.THUMBNAILS_ENABLED = false;
    assert.equal((await fetch("GET", "pending")).status, 503);
});

test("revocation during upload prevents READY", async t => {
    const { fetch, sqlite, env } = await fixture(t);
    const put = env.THUMBNAILS.put;
    env.THUMBNAILS.put = async (...args) => {
        await put(...args);
        sqlite.exec("UPDATE device_credentials SET revoked_at=datetime('now') WHERE device_uuid='native'");
    };
    assert.equal((await fetch("PUT", "", { body: jpeg })).status, 401);
    assert.equal(sqlite.prepare("SELECT state FROM thumbnail_captures").get().state, "PENDING");
});

test("CORS advertises both supported generation headers", async t => {
    const { fetch } = await fixture(t);
    const response = await fetch("OPTIONS", "");
    const allowed = response.headers.get("Access-Control-Allow-Headers").toLowerCase().split(/,\s*/);
    assert.ok(allowed.includes("x-thumbnail-generation"));
    assert.ok(allowed.includes("x-ligron-assignment-generation"));
});

test("logout and revocation deny subsequent reads and producer uploads", async t => {
    const { fetch, owner, env, sqlite } = await fixture(t);
    assert.equal((await fetch("PUT", "", { body: jpeg })).status, 200);
    const authorization = "Bearer " + owner;
    const logout = await worker.fetch(new Request("https://test/api/v1/logout", {
        method: "POST", headers: { Authorization: authorization }
    }), env);
    assert.equal(logout.status, 200);
    assert.equal((await fetch("GET", "/image", { authorization })).status, 401);
    sqlite.exec("UPDATE device_credentials SET revoked_at=datetime('now') WHERE device_uuid='native'");
    assert.equal((await fetch("PUT", "", { body: jpeg })).status, 401);
});

test("assignment switched during R2 put invalidates the pending capture", async t => {
    const { fetch, sqlite, env, objects } = await fixture(t);
    const put = env.THUMBNAILS.put;
    env.THUMBNAILS.put = async (...args) => {
        await put(...args);
        sqlite.exec("UPDATE srt_destinos SET estado='FREE' WHERE usuario_id=1");
    };
    assert.equal((await fetch("PUT", "", { body: jpeg })).status, 409);
    assert.equal(sqlite.prepare("SELECT state FROM thumbnail_captures").get().state, "INVALIDATED");
    assert.equal(objects.size, 0);
});

test("Pi preview works without SRT and retention evicts exactly the oldest object", async t => {
    const { sqlite, call, tokens, env, objects } = await fixture(t);
    sqlite.exec("DELETE FROM srt_destinos");
    const keys = [];
    for (let n = 0; n < 4; n++) {
        sqlite.exec("UPDATE thumbnail_requests SET created_at_ms=0");
        const batch = await (await call("POST", { key: "pi-" + n, targets: [pi()] })).json();
        const capture = batch.captures[0];
        assert.equal(capture.producer, "pi_preview");
        const response = await worker.fetch(new Request(
            "https://test/api/v1/thumbnails/captures/" + capture.capture_id + "?device_uuid=pi", {
                method: "PUT", body: jpeg, headers: { Authorization: "Device " + tokens.pi,
                    "Content-Type": "image/jpeg", "X-Ligron-Assignment-Generation": "preview" }
            }), env);
        assert.equal(response.status, 200);
        keys.push(sqlite.prepare("SELECT object_key FROM thumbnail_captures WHERE capture_id=?")
            .get(capture.capture_id).object_key);
    }
    assert.deepEqual([...objects.keys()], keys.slice(1));
});

test("missing generation, invalid length, wrong producer and missing hub reject before storage", async t => {
    const { fetch, env, tokens, id, operations } = await fixture(t);
    const url = "https://test/api/v1/thumbnails/captures/" + id + "?device_uuid=native";
    const response = await worker.fetch(new Request(url, { method: "PUT", body: jpeg,
        headers: { Authorization: "Device " + tokens.native, "Content-Type": "image/jpeg" } }), env);
    assert.equal(response.status, 400);
    assert.equal((await fetch("PUT", "", { body: jpeg, headers: { "Content-Length": "1" } })).status, 400);
    assert.equal((await fetch("PUT", "", { uuid: "pi", body: jpeg })).status, 404);
    assert.equal((await fetch("POST", "/failure", { uuid: "other", body: '{"code":"NO_FRAME"}' })).status, 404);
    delete env.THUMBNAIL_HUB;
    assert.equal((await fetch("PUT", "", { body: jpeg })).status, 503);
    assert.deepEqual(operations, []);
});

test("capture URL authenticates the assigned producer without query parameters", async t => {
    const { tokens, env, id } = await fixture(t);
    const response = await worker.fetch(new Request("https://test/api/v1/thumbnails/captures/" + id, {
        method: "PUT", body: jpeg, headers: { Authorization: "Device " + tokens.native,
            "Content-Type": "image/jpeg", "X-Ligron-Assignment-Generation": "1" }
    }), env);
    assert.equal(response.status, 200);
});
