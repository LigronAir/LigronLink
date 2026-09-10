"""Exercise the actual SQL against SQLite, including tenant isolation/expiry."""
import pathlib
import re
import sqlite3
import unittest

SQL = re.findall(r'prepare\(`(.*?)`\)',
    (pathlib.Path(__file__).parents[1] / 'src/database/peerStatus.js').read_text(encoding='utf-8'), re.S)

class PeerStatusTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          CREATE TABLE equipos(uuid TEXT,usuario_id INTEGER,alias TEXT,public_ip TEXT,estado TEXT,ultima_conexion TEXT);
          CREATE TABLE device_runtime_status(device_uuid TEXT,usuario_id INTEGER,target_device_uuid TEXT,
            runtime_state TEXT,streaming INTEGER,target_srt_url TEXT,ultima_actualizacion TEXT);
          CREATE TABLE srt_destinos(equipo_uuid TEXT,usuario_id INTEGER,reservado_por_uuid TEXT,source_id INTEGER);
          INSERT INTO equipos VALUES('pi',1,'Pi','198.51.100.20','ONLINE',datetime('now'));
          INSERT INTO equipos VALUES('native',1,'Native','198.51.100.10','ONLINE',datetime('now'));
          INSERT INTO device_runtime_status VALUES('pi',1,'native','ERROR',0,'srt://198.51.100.10:11000?mode=rendezvous&port=11000',datetime('now'));
          INSERT INTO srt_destinos VALUES('native',1,'pi',1);
        ''')
    def test_control_remains_present_when_video_fails(self):
        row = self.db.execute(SQL[0], (1, 'native')).fetchone()
        self.assertEqual((row['control_state'],row['runtime_state'],row['source_id']),('PEER_ONLINE','ERROR',1))
        self.assertEqual(row['peer_public_ip'], '198.51.100.20')
    def test_stale_telemetry_not_connected(self):
        self.db.execute("UPDATE device_runtime_status SET ultima_actualizacion=datetime('now','-80 seconds')")
        self.assertEqual(self.db.execute(SQL[0], (1,'native')).fetchone()['control_state'],'PEER_OFFLINE')
    def test_no_cross_account_or_cross_target(self):
        self.assertEqual(self.db.execute(SQL[0], (2,'native')).fetchall(), [])
        self.assertEqual(self.db.execute(SQL[0], (1,'other')).fetchall(), [])
        self.assertIsNone(self.db.execute(SQL[1], (2,'native')).fetchone())
    def test_target_offline(self):
        self.db.execute("UPDATE equipos SET estado='OFFLINE' WHERE uuid='native'")
        self.assertEqual(self.db.execute(SQL[1],(1,'native')).fetchone()['control_state'],'PEER_OFFLINE')

if __name__ == '__main__': unittest.main()
