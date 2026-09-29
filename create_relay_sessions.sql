-- LigronRelay: per-reservation credentials.  Media stays in MediaMTX; this
-- table is only the authenticated LigronLink control plane.
CREATE TABLE IF NOT EXISTS relay_sessions (
    session_id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    pi_device_uuid TEXT NOT NULL,
    native_device_uuid TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    relay_host TEXT NOT NULL,
    relay_port INTEGER NOT NULL,
    stream_name TEXT NOT NULL UNIQUE,
    publish_token TEXT NOT NULL,
    read_token TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relay_sessions_native
    ON relay_sessions(native_device_uuid, state, expires_at);
CREATE INDEX IF NOT EXISTS idx_relay_sessions_pi
    ON relay_sessions(pi_device_uuid, state, expires_at);
