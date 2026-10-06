-- LigronLink - sesiones opacas de usuario para el panel web.
-- Aplicar en D1 antes de desplegar el Worker que exige Bearer tokens.
CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
    ON auth_sessions(token_hash, expires_at);
