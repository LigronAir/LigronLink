-- Catálogo de versiones LigronPi. D1 conserva sólo metadatos y hashes;
-- los paquetes viven fuera de D1 (temporalmente en el PC de desarrollo y,
-- posteriormente, en R2 privado).
CREATE TABLE IF NOT EXISTS device_update_releases (
    id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    package_url TEXT NOT NULL,
    package_sha256 TEXT NOT NULL,
    package_size INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    published_by_usuario_id INTEGER NOT NULL,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(published_by_usuario_id) REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_device_update_releases_current
    ON device_update_releases(usuario_id, channel, active, created_at DESC);
