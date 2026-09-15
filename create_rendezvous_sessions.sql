-- ### FIX — SRT RENDEZVOUS
CREATE TABLE IF NOT EXISTS rendezvous_sessions (
    session_id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    source_device_uuid TEXT NOT NULL,
    destination_device_uuid TEXT NOT NULL,
    box_id INTEGER NOT NULL,
    session_port INTEGER NOT NULL,
    route TEXT NOT NULL DEFAULT 'RENDEZVOUS',
    pi_public_ip TEXT,
    native_public_ip TEXT,
    pi_ready INTEGER NOT NULL DEFAULT 0,
    native_ready INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'CREATED',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rendezvous_sessions_device ON rendezvous_sessions(destination_device_uuid, state, expires_at);
CREATE INDEX IF NOT EXISTS idx_rendezvous_sessions_source ON rendezvous_sessions(source_device_uuid, state, expires_at);
