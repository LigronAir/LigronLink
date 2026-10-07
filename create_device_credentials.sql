-- LigronLink - credenciales opacas y revocables de equipos preaprovisionados.
-- Sólo se conserva el hash del secreto: D1 nunca puede devolverlo después.
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
