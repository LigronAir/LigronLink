-- Recuperación de LigronPi sin volver a aceptar email + UUID como prueba.
-- La credencial de recuperación sólo identifica a la Pi; una autorización
-- separada y breve del propietario es imprescindible para emitir una nueva
-- credencial operativa.

CREATE TABLE IF NOT EXISTS device_recovery_credentials (
    device_uuid TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY(device_uuid) REFERENCES equipos(uuid)
);

CREATE INDEX IF NOT EXISTS idx_device_recovery_credentials_active
    ON device_recovery_credentials(token_hash, revoked_at);

CREATE TABLE IF NOT EXISTS device_recovery_authorizations (
    device_uuid TEXT PRIMARY KEY,
    authorized_by_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    FOREIGN KEY(device_uuid) REFERENCES equipos(uuid),
    FOREIGN KEY(authorized_by_user_id) REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_device_recovery_authorizations_expiry
    ON device_recovery_authorizations(expires_at);

-- Alta inicial o reemparejamiento sin contraseñas ni secretos mostrados. La
-- Pi guarda un reto aleatorio local; Link sólo guarda su hash hasta que el
-- propietario aprueba el equipo desde su sesión.
CREATE TABLE IF NOT EXISTS device_pairings (
    pairing_id TEXT PRIMARY KEY,
    device_uuid TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL,
    device_type TEXT NOT NULL,
    device_alias TEXT NOT NULL,
    pairing_hash TEXT NOT NULL,
    capabilities_json TEXT,
    state TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    approved_at TEXT,
    consumed_at TEXT,
    FOREIGN KEY(owner_user_id) REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_device_pairings_owner_state
    ON device_pairings(owner_user_id, state, expires_at);
