-- LigronLink - base para autorizar un mismo dispositivo en varias cuentas.
-- Esta migración no activa aún el uso compartido: conserva el propietario
-- actual como miembro OWNER y permite introducir invitaciones seguras después.
CREATE TABLE IF NOT EXISTS device_account_memberships (
    device_uuid TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'OWNER',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT,
    PRIMARY KEY (device_uuid, usuario_id),
    FOREIGN KEY(device_uuid) REFERENCES equipos(uuid),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_device_account_memberships_user
    ON device_account_memberships(usuario_id, revoked_at);

-- Copia la relación única heredada sin alterar ningún equipo existente.
INSERT OR IGNORE INTO device_account_memberships (device_uuid, usuario_id, role)
SELECT uuid, usuario_id, 'OWNER'
FROM equipos;
