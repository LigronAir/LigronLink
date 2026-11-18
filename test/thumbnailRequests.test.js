import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createBatch, thumbnailRequests } from "../src/api/thumbnailRequests.js";

test("comparte capturas reservadas y conserva las vistas Pi y los orígenes externos", async t => {
    const sqlite = new DatabaseSync(":memory:");
    t.after(() => sqlite.close());
    sqlite.exec(`
        CREATE TABLE usuarios (id INTEGER PRIMARY KEY);
        CREATE TABLE equipos (uuid TEXT PRIMARY KEY, usuario_id INTEGER, tipo TEXT, estado TEXT);
        CREATE TABLE srt_destinos (
            id INTEGER PRIMARY KEY, usuario_id INTEGER, equipo_uuid TEXT, source_id INTEGER,
            reservado_por_uuid TEXT, estado TEXT
        );
        INSERT INTO usuarios VALUES (1), (2);
        INSERT INTO equipos VALUES
            ('pi-a', 1, 'ligronpi', 'ONLINE'), ('pi-b', 1, 'ligronpi', 'ONLINE'),
            ('native-a', 1, 'ligronair', 'ONLINE'), ('native-b', 1, 'ligronair', 'BUSY');
        INSERT INTO srt_destinos VALUES
            (1, 1, 'native-a', 7, 'pi-a', 'BUSY'), (2, 1, 'native-b', 8, NULL, 'BUSY');
    `);
    sqlite.exec(readFileSync(new URL("../migrations/0003_thumbnail_requests.sql", import.meta.url), "utf8"));

    const db = {
        prepare(sql) {
            return {
                bind(...args) {
                    const parameters = {};
                    const statement = sqlite.prepare(sql.replace(/\?(\d+)/g, (_, index) => {
                        const name = `$arg${index}`;
                        parameters[name] = args[Number(index) - 1];
                        return name;
                    }));
                    return () => ({ results: statement.all(parameters) });
                }
            };
        },
        async batch(statements) {
            sqlite.exec("BEGIN");
            try {
                const results = statements.map(execute => execute());
                sqlite.exec("COMMIT");
                return results;
            } catch (error) {
                sqlite.exec("ROLLBACK");
                throw error;
            }
        }
    };

    const targets = [
        { kind: "pi", device_uuid: "pi-a" },
        { kind: "pi", device_uuid: "pi-b" },
        { kind: "native_box", device_uuid: "native-a", source_id: 7 },
        { kind: "native_box", device_uuid: "native-b", source_id: 8 }
    ];
    const request = (items = targets, key = "refresh") => new Request("https://example.test", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ targets: items })
    });

    assert.equal((await thumbnailRequests(request(), { THUMBNAILS_ENABLED: false })).status, 503);
    assert.equal((await createBatch(request(), db, 2)).status, 404);
    assert.equal((await createBatch(request(Array(11).fill(targets[0])), db, 1)).status, 400);
    const response = await createBatch(request(), db, 1);
    assert.equal(response.status, 202);
    const batch = await response.json();
    const captureFor = uuid => {
        const target = batch.targets.find(item => item.device_uuid === uuid);
        return batch.captures.find(capture => capture.capture_id === target.capture_id);
    };
    assert.equal(batch.captures.length, 3);
    assert.equal(captureFor("pi-a"), captureFor("native-a"));
    assert.equal(captureFor("native-a").source_device_uuid, "pi-a");
    assert.equal(captureFor("pi-b").producer, "pi_preview");
    assert.equal(captureFor("native-b").source_device_uuid, null);
    assert.equal(Date.parse(batch.expires_at) - Date.parse(batch.created_at), 30_000);
    for (const capture of batch.captures) {
        assert.equal(capture.state, "PENDING");
        assert.equal(capture.generation, null);
        assert.equal(capture.deadline_ms, Date.parse(batch.expires_at));
    }

    sqlite.exec("UPDATE srt_destinos SET estado = 'OFFLINE' WHERE id = 1");
    const replay = await createBatch(request([...targets].reverse()), db, 1);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), batch);
    assert.equal((await createBatch(request([targets[0]]), db, 1)).status, 409);
    assert.equal((await createBatch(request([targets[0]], "another"), db, 1)).status, 429);
});
