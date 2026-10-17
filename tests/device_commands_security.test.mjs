import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { deviceCommands, deviceCommandResult } from "../src/api/deviceCommands.js";
import { deviceAuthorization } from "../src/api/deviceAuthorization.js";
import { credentialHash } from "../src/security/deviceCredentials.js";

const userToken = "u".repeat(40);
const otherToken = "o".repeat(40);
const piToken = "p".repeat(40);
const nativeToken = "n".repeat(40);

async function fixture() {
    const db = new DatabaseSync(":memory:");
    db.exec(`
        CREATE TABLE usuarios (id INTEGER, uuid TEXT, nombre TEXT, email TEXT, estado TEXT);
        CREATE TABLE equipos (id INTEGER, uuid TEXT, usuario_id INTEGER, tipo TEXT, alias TEXT,
            public_ip TEXT, ultima_conexion TEXT, estado TEXT, fecha_creacion TEXT);
        CREATE TABLE auth_sessions (id TEXT, usuario_id INTEGER, token_hash TEXT, revoked_at TEXT, expires_at TEXT);
        CREATE TABLE device_credentials (device_uuid TEXT, token_hash TEXT, revoked_at TEXT);
        CREATE TABLE device_recovery_credentials (device_uuid TEXT, revoked_at TEXT);
        CREATE TABLE device_recovery_authorizations (device_uuid TEXT PRIMARY KEY, authorized_by_user_id INTEGER,
            created_at TEXT, expires_at TEXT, consumed_at TEXT);
        CREATE TABLE srt_destinos (usuario_id INTEGER, equipo_uuid TEXT, reservado_por_uuid TEXT, estado TEXT);
        CREATE TABLE device_runtime_status (usuario_id INTEGER, device_uuid TEXT, target_device_uuid TEXT,
            streaming INTEGER, ultima_actualizacion TEXT);
        CREATE TABLE device_remote_commands (id TEXT, usuario_id INTEGER, sender_device_uuid TEXT,
            target_device_uuid TEXT, command TEXT, payload_json TEXT, expires_at TEXT,
            state TEXT DEFAULT 'PENDING', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            result_message TEXT, completed_at TEXT);
        INSERT INTO usuarios VALUES (1, 'u1', 'Owner', 'owner@example.test', 'ACTIVO'),
            (2, 'u2', 'Other', 'other@example.test', 'ACTIVO');
        INSERT INTO equipos (id, uuid, usuario_id, tipo) VALUES
            (1, 'native', 1, 'ligronair'), (2, 'pi', 1, 'LigronPi'),
            (3, 'other-pi', 2, 'LigronPi');
        INSERT INTO srt_destinos VALUES (1, 'native', 'pi', 'RESERVED');
        INSERT INTO device_recovery_credentials VALUES ('pi', NULL);
    `);
    const session = db.prepare("INSERT INTO auth_sessions VALUES (?, ?, ?, NULL, datetime('now','+1 hour'))");
    session.run("owner", 1, await credentialHash(userToken));
    session.run("other", 2, await credentialHash(otherToken));
    const credential = db.prepare("INSERT INTO device_credentials VALUES (?, ?, NULL)");
    credential.run("pi", await credentialHash(piToken));
    credential.run("native", await credentialHash(nativeToken));
    const adapter = {
        prepare(sql) {
            const stmt = db.prepare(sql.replace(/\?(\d+)/g, ":p$1"));
            return {
                bind(...values) {
                    const parameters = Object.fromEntries(values.map((value, i) => [`p${i + 1}`, value]));
                    return {
                        async first() { return stmt.get(parameters) || null; },
                        async all() { return { results: stmt.all(parameters) }; },
                        async run() { return { meta: { changes: Number(stmt.run(parameters).changes) } }; },
                    };
                },
            };
        },
    };
    return { db, env: { DB: adapter } };
}

function commandRequest(auth, overrides = {}) {
    return new Request("https://example.test/api/v1/device/commands", {
        method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ email: "owner@example.test", device_uuid: "native",
            target_device_uuid: "pi", command: "stream_stop", ...overrides }),
    });
}

function getRequest(auth, uuid = "pi") {
    return new Request(`https://example.test/api/v1/device/commands?email=owner@example.test&device_uuid=${uuid}`,
        { headers: auth ? { Authorization: auth } : {} });
}

function resultRequest(auth) {
    return new Request("https://example.test/api/v1/device/commands/result", {
        method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ email: "owner@example.test", device_uuid: "pi", command_id: "absent", state: "COMPLETED" }),
    });
}

test("email and UUID never authorize enqueue, read, or acknowledgment", async () => {
    const { db, env } = await fixture();
    for (const auth of [undefined, "Basic ignored", `Bearer ${"x".repeat(40)}`, `Device ${"x".repeat(40)}`]) {
        assert.equal((await deviceCommands(commandRequest(auth), env)).status, 401);
        assert.equal((await deviceCommands(getRequest(auth), env)).status, 401);
        assert.equal((await deviceCommandResult(resultRequest(auth), env)).status, 401);
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM device_remote_commands").get().n, 0);
    db.close();
});

test("authenticated Native and provisioned Pi can exchange a command", async () => {
    const { db, env } = await fixture();
    assert.equal((await deviceCommands(commandRequest(`Bearer ${userToken}`), env)).status, 200);
    assert.equal((await deviceCommands(commandRequest(`Device ${nativeToken}`), env)).status, 200);
    const received = await deviceCommands(getRequest(`Device ${piToken}`), env);
    assert.equal(received.status, 200);
    assert.equal((await received.json()).commands.length, 2);
    assert.equal((await deviceCommandResult(resultRequest(`Device ${piToken}`), env)).status, 200);
    db.close();
});

test("credentials and sessions are bound to the device and account, including after revocation", async () => {
    const { db, env } = await fixture();
    assert.equal((await deviceCommands(commandRequest(`Bearer ${otherToken}`), env)).status, 403);
    assert.equal((await deviceCommands(commandRequest(`Device ${piToken}`), env)).status, 401);
    assert.equal((await deviceCommands(getRequest(`Device ${piToken}`, "other-pi"), env)).status, 401);
    assert.equal((await deviceCommands(commandRequest(`Bearer ${userToken}`, { target_device_uuid: "other-pi" }), env)).status, 404);
    db.prepare("UPDATE device_credentials SET revoked_at=CURRENT_TIMESTAMP WHERE device_uuid='pi'").run();
    assert.equal((await deviceCommands(getRequest(`Device ${piToken}`), env)).status, 401);
    assert.equal((await deviceCommandResult(resultRequest(`Device ${piToken}`), env)).status, 401);
    db.close();
});

test("only the owner can reauthorize a Pi after a previous approval was consumed", async () => {
    const { db, env } = await fixture();
    const request = (auth) => new Request("https://example.test/api/v1/device/authorization", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ device_uuid: "pi" }),
    });
    assert.equal((await deviceAuthorization(request(`Bearer ${otherToken}`), env)).status, 403);
    assert.equal((await deviceAuthorization(request(`Bearer ${userToken}`), env)).status, 200);
    db.prepare("UPDATE device_recovery_authorizations SET consumed_at=CURRENT_TIMESTAMP WHERE device_uuid='pi'").run();
    assert.equal((await deviceAuthorization(request(`Bearer ${userToken}`), env)).status, 200);
    assert.equal(db.prepare("SELECT consumed_at FROM device_recovery_authorizations WHERE device_uuid='pi'").get().consumed_at, null);
    db.close();
});
