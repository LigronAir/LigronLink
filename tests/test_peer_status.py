"""Exercise the actual SQL against SQLite, including tenant isolation/expiry."""
import pathlib
import re
import sqlite3
import unittest

SOURCE = (pathlib.Path(__file__).parents[1] / 'src/database/peerStatus.js').read_text(encoding='utf-8')
RESERVED_SQL = re.search(r'const reservedSql = `\s*(.*?)\s*`;', SOURCE, re.S).group(1)
SQL = re.findall(r'prepare\(`(.*?)`\)', SOURCE, re.S)
TARGET_SQL = SQL[-1]

class PeerStatusTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          CREATE TABLE equipos(uuid TEXT,usuario_id INTEGER,alias TEXT,public_ip TEXT,estado TEXT,ultima_conexion TEXT);
          CREATE TABLE device_runtime_status(device_uuid TEXT,usuario_id INTEGER,target_device_uuid TEXT,
            runtime_state TEXT,streaming INTEGER,pipeline_active INTEGER,signal_available INTEGER,
            target_srt_url TEXT,telemetry_json TEXT,ultima_actualizacion TEXT);
          CREATE TABLE srt_destinos(equipo_uuid TEXT,usuario_id INTEGER,reservado_por_uuid TEXT,source_id INTEGER,nombre TEXT,estado TEXT,host TEXT,port INTEGER,mode TEXT);
          INSERT INTO equipos VALUES('pi',1,'Pi','', 'ONLINE',datetime('now'));
          INSERT INTO equipos VALUES('native',1,'Native','', 'ONLINE',datetime('now'));
          INSERT INTO device_runtime_status VALUES('pi',1,'native','ERROR',0,1,0,'','{}',datetime('now'));
          INSERT INTO srt_destinos VALUES('native',1,'pi',1,'Caja 01','RESERVED','',11000,'listener');
        ''')
    def test_control_remains_present_when_video_fails(self):
        row = self.db.execute(RESERVED_SQL, (1, 'native')).fetchone()
        self.assertEqual((row['control_state'],row['runtime_state'],row['source_id']),('PEER_ONLINE','ERROR',1))
        self.assertEqual((row['pipeline_active'], row['signal_available']), (1, 0))
    def test_stale_telemetry_not_connected(self):
        self.db.execute("UPDATE equipos SET ultima_conexion=datetime('now','-80 seconds') WHERE uuid='pi'")
        self.assertEqual(self.db.execute(RESERVED_SQL, (1,'native')).fetchone()['control_state'],'PEER_OFFLINE')
    def test_no_cross_account_or_cross_target(self):
        self.assertEqual(self.db.execute(RESERVED_SQL, (2,'native')).fetchall(), [])
        self.assertEqual(self.db.execute(RESERVED_SQL, (1,'other')).fetchall(), [])
        self.assertIsNone(self.db.execute(TARGET_SQL, (2,'native','')).fetchone())
    def test_target_offline(self):
        self.db.execute("UPDATE equipos SET estado='OFFLINE' WHERE uuid='native'")
        self.assertEqual(self.db.execute(TARGET_SQL,(1,'native','')).fetchone()['control_state'],'PEER_OFFLINE')

if __name__ == '__main__': unittest.main()
