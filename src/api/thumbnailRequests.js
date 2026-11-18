import { requireUserSession } from "../security/sessions.js";
import { THUMBNAIL_POLICY } from "../thumbnails/policy.js";

const headers = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Cache-Control": "no-store"
};

function fail(status, error, extraHeaders = {}) {
    return Response.json({ success: false, error }, {
        status, headers: { ...headers, ...extraHeaders }
    });
}

function normalizeTargets(items) {
    if (!Array.isArray(items) || !items.length || items.length > THUMBNAIL_POLICY.maxTargetsPerRefresh) {
        return null;
    }
    const targets = new Map();
    for (const item of items) {
        if (typeof item?.device_uuid !== "string" || !item.device_uuid.trim()) return null;
        const target = { kind: item.kind, device_uuid: item.device_uuid };
        if (item.kind === "native_box") {
            if (!Number.isSafeInteger(item.source_id) || item.source_id < 0) return null;
            target.source_id = item.source_id;
        } else if (item.kind !== "pi") {
            return null;
        }
        const key = JSON.stringify(target);
        if (targets.has(key)) return null;
        targets.set(key, target);
    }
    return [...targets.keys()].sort().map(key => targets.get(key));
}

const piTypes = "('ligronpi', 'ligronpi native')";
const nativeTypes = "('ligronair', 'ligronair_native')";
const nativeReservations = `
    FROM srt_destinos AS destination
    JOIN equipos AS native ON native.uuid = destination.equipo_uuid
        AND native.usuario_id = destination.usuario_id AND lower(native.tipo) IN ${nativeTypes}
    WHERE destination.usuario_id = ?1 AND destination.estado = 'BUSY'
      AND native.estado IN ('ONLINE', 'BUSY')
`;

function resolveTarget(db, userId, target) {
    if (target.kind === "pi") {
        return db.prepare(`
            WITH reservations AS (
                SELECT destination.id, destination.equipo_uuid, destination.source_id,
                       destination.reservado_por_uuid
                ${nativeReservations}
                  AND native.estado = 'ONLINE'
            )
            SELECT CASE WHEN reservation.id IS NULL THEN 'pi_preview' ELSE 'native_box' END AS producer,
                   COALESCE(reservation.equipo_uuid, pi.uuid) AS producer_device_uuid,
                   reservation.source_id, pi.uuid AS source_device_uuid
            FROM equipos AS pi
            LEFT JOIN reservations AS reservation ON reservation.reservado_por_uuid = pi.uuid
            WHERE pi.usuario_id = ?1 AND pi.uuid = ?2 AND lower(pi.tipo) IN ${piTypes}
              AND pi.estado IN ('ONLINE', 'BUSY')
            ORDER BY reservation.id
            LIMIT 1
        `).bind(userId, target.device_uuid);
    }
    return db.prepare(`
        SELECT 'native_box' AS producer, destination.equipo_uuid AS producer_device_uuid,
               destination.source_id, destination.reservado_por_uuid AS source_device_uuid
        ${nativeReservations}
          AND destination.equipo_uuid = ?2 AND destination.source_id = ?3
          AND (destination.reservado_por_uuid IS NULL OR EXISTS (
              SELECT 1 FROM equipos AS pi
              WHERE pi.uuid = destination.reservado_por_uuid
                AND pi.usuario_id = ?1 AND lower(pi.tipo) IN ${piTypes}
          ))
        ORDER BY destination.id
        LIMIT 1
    `).bind(userId, target.device_uuid, target.source_id);
}

function findByKey(db, userId, key) {
    return db.prepare(`
        SELECT batch_id, target_signature
        FROM thumbnail_requests
        WHERE usuario_id = ?1 AND idempotency_key = ?2
    `).bind(userId, key);
}

async function replay(db, userId, row, signature) {
    if (row.target_signature !== signature) return fail(409, "Idempotency-Key already used");
    return readBatch(db, userId, row.batch_id);
}

async function readTargets(request) {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const buffer = new Uint8Array(8192);
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (size + value.byteLength > buffer.length) {
                await reader.cancel();
                return null;
            }
            buffer.set(value, size);
            size += value.byteLength;
        }
        const json = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
        return normalizeTargets(JSON.parse(json)?.targets);
    } catch {
        return null;
    } finally {
        reader.releaseLock();
    }
}

export async function createBatch(request, db, userId) {
    const key = request.headers.get("Idempotency-Key");
    const targets = await readTargets(request);
    if (!key || key.length > 255 || !/^[!-~]+$/.test(key) || !targets) {
        return fail(400, "Invalid targets or Idempotency-Key");
    }

    const signature = JSON.stringify(targets);
    const now = Date.now();
    const [existing, ...resolved] = await db.batch([
        findByKey(db, userId, key),
        ...targets.map(target => resolveTarget(db, userId, target))
    ]);
    if (existing.results[0]) return replay(db, userId, existing.results[0], signature);
    if (resolved.some(result => !result.results.length)) return fail(404, "Target not found");

    const deadline = now + THUMBNAIL_POLICY.requestLifetimeMs;
    const captures = new Map();
    const mappedTargets = targets.map((target, index) => {
        const source = resolved[index].results[0];
        const origin = JSON.stringify([source.producer, source.producer_device_uuid, source.source_id]);
        let capture = captures.get(origin);
        if (!capture) {
            capture = {
                capture_id: crypto.randomUUID(),
                ...source,
                state: "PENDING",
                generation: null,
                deadline_ms: deadline
            };
            captures.set(origin, capture);
        }
        return { ...target, capture_id: capture.capture_id };
    });
    const batch = {
        batch_id: crypto.randomUUID(),
        status: "PENDING",
        created_at: new Date(now).toISOString(),
        expires_at: new Date(deadline).toISOString(),
        targets: mappedTargets,
        captures: [...captures.values()]
    };
    const cutoff = now - THUMBNAIL_POLICY.minRefreshIntervalMs;
    const statements = [
        db.prepare(`
            INSERT INTO thumbnail_requests
                (batch_id, usuario_id, idempotency_key, target_signature, created_at_ms, expires_at_ms, response_json)
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
            WHERE NOT EXISTS (
                SELECT 1 FROM thumbnail_requests WHERE usuario_id = ?2 AND created_at_ms > ?8
            )
            ON CONFLICT (usuario_id, idempotency_key) DO NOTHING
        `).bind(batch.batch_id, userId, key, signature, now, deadline, JSON.stringify(batch), cutoff),
        ...batch.captures.map(capture => db.prepare(`
            INSERT INTO thumbnail_captures
                (batch_id, capture_id, producer, producer_device_uuid, source_id, source_device_uuid,
                 state, generation, deadline_at)
            SELECT batch_id, ?2, ?3, ?4, ?5, ?6, 'PENDING', NULL, ?7
            FROM thumbnail_requests WHERE batch_id = ?1
        `).bind(batch.batch_id, capture.capture_id, capture.producer, capture.producer_device_uuid,
            capture.source_id, capture.source_device_uuid, deadline)),
        ...mappedTargets.map((target, position) => db.prepare(`
            INSERT INTO thumbnail_request_targets
                (batch_id, position, kind, device_uuid, source_id, capture_id)
            SELECT batch_id, ?2, ?3, ?4, ?5, ?6 FROM thumbnail_requests WHERE batch_id = ?1
        `).bind(batch.batch_id, position, target.kind, target.device_uuid, target.source_id ?? null,
            target.capture_id)),
        findByKey(db, userId, key),
        db.prepare(`
            SELECT MAX(created_at_ms) AS last_refresh
            FROM thumbnail_requests
            WHERE usuario_id = ?1 AND created_at_ms > ?2
        `).bind(userId, cutoff)
    ];

    let results;
    try {
        results = await db.batch(statements);
    } catch (error) {
        console.error("Failed to persist thumbnail request", error);
        return fail(500, "Could not create thumbnail request");
    }
    const [saved, recent] = results.slice(-2);
    const row = saved.results[0];
    if (row?.batch_id === batch.batch_id) return Response.json(batch, { status: 202, headers });
    if (row) return replay(db, userId, row, signature);
    const retryMs = recent.results[0].last_refresh + THUMBNAIL_POLICY.minRefreshIntervalMs - now;
    return fail(429, "Refresh quota exceeded", { "Retry-After": String(Math.max(1, Math.ceil(retryMs / 1000))) });
}

async function readBatch(db, userId, batchId) {
    const [result, , captures] = await db.batch([
        db.prepare(`
            SELECT response_json, expires_at_ms FROM thumbnail_requests
            WHERE usuario_id = ?1 AND batch_id = ?2
        `).bind(userId, batchId),
        db.prepare(`
            UPDATE thumbnail_captures SET state = 'EXPIRED'
            WHERE batch_id = ?2 AND state = 'PENDING' AND deadline_at <= ?3
              AND EXISTS (SELECT 1 FROM thumbnail_requests WHERE usuario_id = ?1 AND batch_id = ?2)
        `).bind(userId, batchId, Date.now()),
        db.prepare(`
            SELECT capture.capture_id, capture.producer, capture.producer_device_uuid,
                   capture.source_id, capture.source_device_uuid, capture.state,
                   capture.generation, capture.deadline_at AS deadline_ms
            FROM thumbnail_captures AS capture
            JOIN thumbnail_requests AS request ON request.batch_id = capture.batch_id
            WHERE request.usuario_id = ?1 AND capture.batch_id = ?2
            ORDER BY (
                SELECT MIN(target.position) FROM thumbnail_request_targets AS target
                WHERE target.batch_id = capture.batch_id AND target.capture_id = capture.capture_id
            ), capture.capture_id
        `).bind(userId, batchId)
    ]);
    const row = result.results[0];
    if (!row) return fail(404, "Batch not found");
    const batch = JSON.parse(row.response_json);
    batch.expires_at = new Date(row.expires_at_ms).toISOString();
    batch.captures = captures.results;
    batch.status = batch.captures.length && batch.captures.every(capture => capture.state === "EXPIRED")
        ? "EXPIRED" : "PENDING";
    return Response.json(batch, { headers });
}

export async function thumbnailRequests(request, env, batchId) {
    if (env.THUMBNAILS_ENABLED !== true && env.THUMBNAILS_ENABLED !== "true") {
        return fail(503, "Thumbnails disabled");
    }
    const db = env.DB;
    const user = await requireUserSession(request, db);
    if (!user) return fail(401, "Authentication required");
    if (request.method === "POST") return createBatch(request, db, user.id);
    if (request.method !== "GET" || !batchId) return fail(405, "Method not allowed");

    return readBatch(db, user.id, batchId);
}
