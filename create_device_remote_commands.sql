-- Cola de control remoto LigronPi. Las órdenes no transportan vídeo ni
-- secretos: la Pi las recoge mediante su heartbeat HTTPS y acusa recibo.
CREATE TABLE IF NOT EXISTS device_remote_commands (
    id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    sender_device_uuid TEXT NOT NULL,
    target_device_uuid TEXT NOT NULL,
    command TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING',
    result_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    expires_at TEXT NOT NULL,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(sender_device_uuid) REFERENCES equipos(uuid),
    FOREIGN KEY(target_device_uuid) REFERENCES equipos(uuid)
);

CREATE INDEX IF NOT EXISTS idx_device_remote_commands_target
    ON device_remote_commands(target_device_uuid, state, created_at);
