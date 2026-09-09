-- ==========================================================
-- LigronLink
-- D1 - Estado runtime de equipos
-- ==========================================================

CREATE TABLE IF NOT EXISTS device_runtime_status (
    device_uuid TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL,

    runtime_state TEXT NOT NULL DEFAULT 'OFFLINE',
    source_label TEXT,
    target_device_uuid TEXT,
    target_label TEXT,
    target_srt_url TEXT,
    streaming INTEGER NOT NULL DEFAULT 0,
    pipeline_active INTEGER NOT NULL DEFAULT 0,
    signal_available INTEGER NOT NULL DEFAULT 0,
    audio_state TEXT,

    ultima_actualizacion TEXT NOT NULL,

    FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(device_uuid) REFERENCES equipos(uuid)
);

CREATE INDEX IF NOT EXISTS idx_device_runtime_status_usuario
    ON device_runtime_status(usuario_id);
