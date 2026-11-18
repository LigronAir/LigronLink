CREATE TABLE thumbnail_requests (
    batch_id TEXT PRIMARY KEY NOT NULL,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    target_signature TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    UNIQUE (usuario_id, idempotency_key)
);

CREATE INDEX thumbnail_requests_user_created
    ON thumbnail_requests (usuario_id, created_at_ms);

CREATE TABLE thumbnail_captures (
    capture_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL REFERENCES thumbnail_requests(batch_id) ON DELETE CASCADE,
    producer TEXT NOT NULL,
    producer_device_uuid TEXT NOT NULL,
    source_id INTEGER,
    source_device_uuid TEXT,
    state TEXT NOT NULL,
    generation INTEGER,
    deadline_at INTEGER NOT NULL
);

CREATE INDEX thumbnail_captures_batch ON thumbnail_captures(batch_id);

CREATE TABLE thumbnail_request_targets (
    batch_id TEXT NOT NULL REFERENCES thumbnail_requests(batch_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    device_uuid TEXT NOT NULL,
    source_id INTEGER,
    capture_id TEXT NOT NULL REFERENCES thumbnail_captures(capture_id) ON DELETE CASCADE,
    PRIMARY KEY (batch_id, position)
);

CREATE INDEX thumbnail_request_targets_capture
    ON thumbnail_request_targets (capture_id, batch_id, position);
