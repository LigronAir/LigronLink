import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { deleteDevice } from '../src/database/devices.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE equipos(id INTEGER PRIMARY KEY, uuid TEXT UNIQUE, usuario_id INTEGER);
    CREATE TABLE device_credentials(device_uuid TEXT REFERENCES equipos(uuid));
    CREATE TABLE device_recovery_credentials(device_uuid TEXT REFERENCES equipos(uuid));
    CREATE TABLE device_recovery_authorizations(device_uuid TEXT REFERENCES equipos(uuid));
    CREATE TABLE device_pairings(device_uuid TEXT, owner_user_id INTEGER);
    CREATE TABLE device_runtime_status(device_uuid TEXT, target_device_uuid TEXT);
    CREATE TABLE device_remote_commands(usuario_id INTEGER, sender_device_uuid TEXT REFERENCES equipos(uuid), target_device_uuid TEXT REFERENCES equipos(uuid));
    CREATE TABLE srt_destinos(equipo_uuid TEXT, usuario_id INTEGER, reservado_por_uuid TEXT, estado TEXT);
    INSERT INTO equipos VALUES(1,'native',1),(2,'other',2);
    INSERT INTO device_credentials VALUES('native'),('other');
    INSERT INTO device_recovery_credentials VALUES('native');
    INSERT INTO device_recovery_authorizations VALUES('native');
    INSERT INTO device_pairings VALUES('native',1),('other',2);
    INSERT INTO device_runtime_status VALUES('native',NULL);
    INSERT INTO device_remote_commands VALUES(1,'native','native');
    INSERT INTO srt_destinos VALUES('native',1,NULL,'FREE');`);
  const adapter = {
    prepare(sql) {
      const statement = db.prepare(sql.replace(/\?(\d+)/g, ':p$1'));
      return { bind(...args) {
        const parameters = Object.fromEntries(args.map((v, i) => [`p${i + 1}`, v]));
        return { async first() { return statement.get(parameters) || null; },
          async run() { return {meta:{changes:Number(statement.run(parameters).changes)}}; } };
      }};
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  return {db, adapter};
}

test('elimina credenciales y equipo en una transacción sin tocar otra cuenta', async () => {
  const {db, adapter} = fixture();
  await deleteDevice(adapter, 1, 1);
  assert.deepEqual(db.prepare('SELECT uuid FROM equipos').all().map(x => x.uuid), ['other']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM device_credentials WHERE device_uuid = ?').get('other').n, 1);
});

test('no permite eliminar equipos de otra cuenta', async () => {
  const {db, adapter} = fixture();
  await assert.rejects(deleteDevice(adapter, 2, 1));
  assert.equal(db.prepare('SELECT count(*) AS n FROM equipos').get().n, 2);
});
