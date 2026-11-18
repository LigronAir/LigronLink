import { requireDeviceCredential } from "../security/deviceCredentials.js";
import { requireUserSession } from "../security/sessions.js";
import { THUMBNAIL_POLICY as policy } from "../thumbnails/policy.js";



async function readLimited(request, limit) {
    const length = request.headers.get("Content-Length");
    if (length !== null && !/^\d+$/.test(length)) return { status: 400 };
    if (Number(length) > limit) return { status: 413 };
    const reader = request.body?.getReader();
    if (!reader) return { status: 400 };
    const buffer = new Uint8Array(limit);
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (size + value.length > limit) {
                await reader.cancel();
                return { status: 413 };
            }
            buffer.set(value, size);
            size += value.length;
        }
    } finally {
        reader.releaseLock();
    }
    if (length !== null && Number(length) !== size) return { status: 400 };
    return { bytes: buffer.subarray(0, size) };
}

// Walk length-delimited segments and stuffed entropy bytes without decoding pixels.
function validJpeg(bytes) {
    const word = i => bytes[i] * 256 + bytes[i + 1];
    if (word(0) !== 0xffd8) return false;
    let frame = false;
    let scanning = false;
    let sawScan = false;
    for (let i = 2; i < bytes.length;) {
        if (bytes[i++] !== 255) {
            if (scanning) continue;
            return false;
        }
        while (bytes[i] === 255) i++;
        const marker = bytes[i++];
        if (scanning && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
        scanning = false;
        if (marker === 0xd9) return sawScan && i === bytes.length;
        if (i + 2 > bytes.length) return false;
        const length = word(i);
        if (length < 2 || i + length > bytes.length) return false;
        if ([0xc0, 0xc2].includes(marker)) {
            const height = word(i + 3), width = word(i + 5);
            const components = bytes[i + 7];
            if (frame || length !== 8 + 3 * components || !components || bytes[i + 2] !== 8 ||
                !width || width > policy.maxWidth || !height || height > policy.maxHeight) return false;
            frame = true;
        } else if (marker === 0xda) {
            if (!frame || !bytes[i + 2] || length !== 6 + 2 * bytes[i + 2]) return false;
            scanning = sawScan = true;
        } else if (!(marker >= 0xe0 && marker <= 0xef) && ![0xfe, 0xdb, 0xc4, 0xdd].includes(marker)) {
            return false;
        }
        i += length;
    }
    return false;
}


const headers = { "Cache-Control": "private, no-store", "Access-Control-Allow-Origin": "https://ligronair.tv" };
const json = (value, status = 200) => Response.json(value, { status, headers });
class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function reject(status, message) { throw new HttpError(status, message); }

const accountJoin = ` FROM thumbnail_captures c JOIN thumbnail_requests r ON r.batch_id=c.batch_id
    JOIN equipos e ON e.uuid=c.producer_device_uuid AND e.usuario_id=r.usuario_id`;
const assignment = `(c.producer='pi_preview' OR (c.producer='native_box' AND EXISTS (
    SELECT 1 FROM srt_destinos d WHERE d.usuario_id=r.usuario_id AND d.estado='BUSY'
    AND d.equipo_uuid=c.producer_device_uuid AND d.source_id=c.source_id
    AND (d.reservado_por_uuid IS NULL OR EXISTS (SELECT 1 FROM equipos pi WHERE pi.uuid=d.reservado_por_uuid AND pi.usuario_id=r.usuario_id))
    AND d.reservado_por_uuid IS c.source_device_uuid)))`;

async function boundedBody(request, limit) {
    const { status, bytes } = await readLimited(request, limit);
    if (status) reject(status, "Invalid request body");
    return bytes;
}

async function digest(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        n => n.toString(16).padStart(2, "0")).join("");
}

function hubClient(env, account) {
    const namespace = env.THUMBNAIL_HUB;
    const stub = namespace.getByName(String(account));
    return async (operation, ...args) => {
        const response = await stub.fetch("https://hub.internal/", {
            method: "POST", body: JSON.stringify({ operation, args })
        });
        if (!response.ok) reject(503, "Storage unavailable");
        const result = await response.json();
        if (result.ok === false) reject(429, "Quota exceeded");
        return result;
    };
}

async function handle(request, env, action, id) {
    if (![true, "true"].includes(env.THUMBNAILS_ENABLED)) reject(503, "Thumbnails disabled");
    const db = env.DB;
    const image = action === "image";
    let device = new URL(request.url).searchParams.get("device_uuid");
    if (!image && id && device === null) {
        device = (await db.prepare("SELECT producer_device_uuid FROM thumbnail_captures WHERE capture_id=?1")
            .bind(id).first())?.producer_device_uuid;
    }
    const auth = image ? await requireUserSession(request, db) : await requireDeviceCredential(request, db, device);
    if (!auth) reject(401, "Authentication required");
    if (action === "pending") {
        const scope = `${accountJoin} WHERE e.uuid=?1 AND c.state='PENDING' AND c.deadline_at>?2`;
        const now = Date.now();
        const [, { results }] = await db.batch([
            db.prepare(`UPDATE thumbnail_captures SET state='INVALIDATED', failure_code='ASSIGNMENT_CHANGED',
                failed_at_ms=?2 WHERE capture_id IN (SELECT c.capture_id ${scope} AND NOT ${assignment})`)
                .bind(device, now),
            db.prepare(`SELECT c.capture_id,c.producer,c.producer_device_uuid,c.source_id,c.source_device_uuid,
                c.deadline_at,c.batch_id AS request_id,c.generation, ?3 AS max_width, ?4 AS max_height,
                ?5 AS max_bytes ${scope} AND ${assignment} ORDER BY c.deadline_at,c.capture_id LIMIT 10`)
                .bind(device, now, policy.maxWidth, policy.maxHeight, policy.maxBytes)
        ]);
        return json({ captures: results });
    }
    const scope = image ? "r.usuario_id=?2" : "e.uuid=?2";
    const identity = image ? auth.id : device;
    const lookup = `${accountJoin} WHERE c.capture_id=?1 AND ${scope}`;
    const load = () => db.prepare(`SELECT c.*,r.usuario_id,${assignment} AS valid ${lookup}`)
        .bind(id, identity).first();
    // Repeat authorization, deadline and assignment checks at each state transition.
    const update = (set, guard, ...values) => db.prepare(`UPDATE thumbnail_captures SET ${set}
        WHERE capture_id IN (SELECT c.capture_id ${lookup} AND ${guard}) RETURNING capture_id`)
        .bind(id, identity, ...values).first();
    async function current() {
        const row = await load();
        if (!row) reject(404, "Capture not found");
        if (row.deadline_at <= Date.now()) reject(image ? 404 : 409, "Capture expired");
        if (!row.valid && ["PENDING", "READY"].includes(row.state)) {
            await update("state='INVALIDATED',failure_code='ASSIGNMENT_CHANGED',failed_at_ms=?3", `c.state IN ('PENDING','READY') AND NOT ${assignment}`, Date.now());
            reject(409, "Assignment changed");
        }
        return row;
    }
    let row = await current();
    const pending = `c.state='PENDING' AND c.deadline_at>?3 AND ${assignment}`;
    if (action === "failure") {
        let body;
        const bytes = await boundedBody(request, 1024);
        try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { reject(400, "Invalid failure"); }
        const code = body?.error_code ?? body?.code ?? body?.error;
        if (!["NO_FRAME", "ASSIGNMENT_CHANGED", "ENCODE_FAILED", "UPLOAD_FAILED"].includes(code)) reject(400, "Invalid failure");
        if (!await update("state='FAILED',failed_at_ms=?3,failure_code=?4", pending, Date.now(), code)) {
            reject(409, "Capture unavailable");
        }
        return json({ state: "FAILED" });
    }
    if (!env.THUMBNAILS || !env.THUMBNAIL_HUB) reject(503, "Storage unavailable");
    const hub = hubClient(env, row.usuario_id);
    const bucket = env.THUMBNAILS;
    if (image) {
        if (row.state !== "READY") reject(404, "Image unavailable");
        await hub("reserveRead");
        row = await current();
        if (row.state !== "READY") reject(404, "Image unavailable");
        const object = await bucket.get(row.object_key);
        if (!object) {
            await update("state='FAILED',failure_code='OBJECT_MISSING',failed_at_ms=?3", "c.state='READY'", Date.now());
            reject(404, "Image unavailable");
        }
        if ((await current()).state !== "READY") reject(404, "Image unavailable");
        return new Response(object.body, { headers: { ...headers, "Content-Type": "image/jpeg",
            "X-Content-Type-Options": "nosniff", ETag: '"' + row.sha256 + '"' } });
    }
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "image/jpeg")
        reject(415, "JPEG required");
    const generation = request.headers.get("X-Ligron-Assignment-Generation");
    if (!generation || !/^[A-Za-z0-9._:-]{1,128}$/.test(generation)) reject(400, "Invalid generation");
    const bytes = await boundedBody(request, policy.maxBytes);
    if (!validJpeg(bytes)) reject(400, "Invalid JPEG");
    const sha = await digest(bytes);
    row = await current();
    if ((row.generation !== null && row.generation !== generation) || (row.sha256 && row.sha256 !== sha)) reject(409, "Conflicting upload");
    if (row.state === "READY") return json({ state: "READY" });
    if (row.state !== "PENDING") reject(409, "Capture unavailable");
    const now = Date.now();
    const captured = Number(request.headers.get("X-Ligron-Captured-At-Ms") ?? now);
    if (!Number.isSafeInteger(captured) || captured < 0) reject(400, "Invalid timestamp");
    const origin = JSON.stringify([row.producer, row.producer_device_uuid, row.source_id]);
    const reservation = await hub("reserve", row.usuario_id, origin);
    const claimed = await update("sha256=?4,object_key=?5,generation=?6,captured_at_ms=?7,received_at_ms=?3",
        `${pending} AND c.sha256 IS NULL AND (c.generation IS NULL OR c.generation=?6)`,
        Date.now(), sha, `thumbnails/${row.usuario_id}/${id}/${sha}`, generation, captured);
    row = await current();
    if (row.sha256 !== sha || row.generation !== generation) reject(409, "Conflicting upload");
    if (row.state === "READY") return json({ state: "READY" });
    if (row.state !== "PENDING") reject(409, "Capture unavailable");
    let stored = false;
    if (!claimed) {
        await hub("reserveRead");
        const existing = await bucket.get(row.object_key);
        if (existing) {
            if (await digest(await existing.arrayBuffer()) !== sha) reject(409, "Conflicting object");
            stored = true;
        }
    }
    if (!stored) await bucket.put(row.object_key, bytes);
    const { expired } = await hub("recordSnapshot", reservation.historyKey, row.object_key);
    for (const old of expired) await bucket.delete(old);
    if (!await requireDeviceCredential(request, db, device)) reject(401, "Authentication required");
    const ready = await update("state='READY',ready_at_ms=?3", `${pending} AND c.sha256=?4`, Date.now(), sha);
    if (!ready) {
        const latest = await load();
        if (latest?.state !== "READY" || !latest.valid || latest.deadline_at <= Date.now()) {
            await bucket.delete(row.object_key);
            await current();
            reject(409, "Capture unavailable");
        }
    }
    return json({ state: "READY" });
}

export async function captureEndpoint(request, env, action, captureId) {
    try { return await handle(request, env, action, captureId); }
    catch (error) {
        return error instanceof HttpError ? json({ success: false, error: error.message }, error.status)
            : json({ success: false, error: "Capture service unavailable" }, 503);
    }
}
