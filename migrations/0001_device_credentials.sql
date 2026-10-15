-- Credenciales opacas, revocables y asociadas a una sola Pi o Native.
-- IF NOT EXISTS permite adoptar de forma segura instalaciones ya reparadas.
CREATE TABLE IF NOT EXISTS device_credentials (
    device_uuid TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY(device_uuid) REFERENCES equipos(uuid)
);

CREATE INDEX IF NOT EXISTS idx_device_credentials_active
    ON device_credentials(token_hash, revoked_at);
