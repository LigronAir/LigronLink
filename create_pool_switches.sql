-- Pool: operación persistente de sustitución de una vía.
-- Sólo se escribe cuando un operador reclama/cambia una fuente; nunca en un
-- heartbeat. Las respuestas de las Pi hacen avanzar el estado.
CREATE TABLE IF NOT EXISTS pool_switches (
    id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    native_device_uuid TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    outgoing_pi_uuid TEXT,
    incoming_pi_uuid TEXT NOT NULL,
    stop_command_id TEXT,
    start_command_id TEXT,
    state TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL DEFAULT (datetime('now','+5 minutes'))
);

CREATE INDEX IF NOT EXISTS idx_pool_switches_active
    ON pool_switches(usuario_id, native_device_uuid, source_id, state);

-- Impide dos operaciones pendientes simultáneas sobre la misma vía incluso
-- si dos navegadores la sueltan a la vez. Los historiales ACTIVE/FAILED se
-- conservan; sólo STOPPING/ARMING requieren exclusividad.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_switches_single_pending_via
    ON pool_switches(usuario_id, native_device_uuid, source_id)
    WHERE state IN ('STOPPING', 'ARMING');
