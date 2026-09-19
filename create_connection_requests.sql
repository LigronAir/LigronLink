-- ### FIX — NATIVE-OWNED CONNECTION ORCHESTRATION
CREATE TABLE IF NOT EXISTS connection_requests (
    request_id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    pi_device_uuid TEXT NOT NULL,
    native_device_uuid TEXT NOT NULL,
    source_id INTEGER,
    host TEXT,
    port INTEGER,
    requested_transport TEXT NOT NULL DEFAULT 'AUTO',
    active_transport TEXT,
    state TEXT NOT NULL DEFAULT 'PENDING',
    activation_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connection_requests_native ON connection_requests(native_device_uuid, state, expires_at);
CREATE INDEX IF NOT EXISTS idx_connection_requests_pi ON connection_requests(pi_device_uuid, state, expires_at);
