CREATE TABLE IF NOT EXISTS equipos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    alias TEXT NOT NULL,

    -- ### FIX
    public_ip TEXT,

    -- ### FIX
    ultima_conexion TEXT,

    fecha_creacion TEXT NOT NULL,
    estado TEXT NOT NULL,

    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);