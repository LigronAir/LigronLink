-- ==========================================================
-- LigronLink
-- D1 - Tabla de destinos/receptores SRT
-- ==========================================================

CREATE TABLE IF NOT EXISTS srt_destinos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    equipo_uuid TEXT NOT NULL,
    usuario_id INTEGER NOT NULL,

    source_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,

    mode TEXT NOT NULL DEFAULT 'listener',
    estado TEXT NOT NULL DEFAULT 'FREE',

    reservado_por_uuid TEXT,

    ultima_actualizacion TEXT NOT NULL,
    fecha_creacion TEXT NOT NULL,

    FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(equipo_uuid) REFERENCES equipos(uuid),

    UNIQUE(equipo_uuid, source_id)
);

CREATE INDEX IF NOT EXISTS idx_srt_destinos_usuario_estado
    ON srt_destinos(usuario_id, estado);

CREATE INDEX IF NOT EXISTS idx_srt_destinos_equipo
    ON srt_destinos(equipo_uuid);