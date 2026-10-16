// ==========================================================
// LigronLink - vinculación inicial de una LigronPi
// ==========================================================

import { findUserByEmail } from "../database/users.js";
import { findDeviceByUuid, registerOrUpdateDevice } from "../database/devices.js";
import { issueDeviceIdentity, credentialHash } from "../security/deviceCredentials.js";
import { requireUserSession } from "../security/sessions.js";

const headers = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store"
};

function token(bytes = 24) {
    const value = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...value))
        .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isSecret(value) {
    return /^[A-Za-z0-9_-]{32,}$/.test(value);
}

function isLigronPi(type) {
    return ["ligronpi", "ligronpi native", "ligronpi_native"]
        .includes(String(type || "").trim().toLowerCase());
}

async function pairingOwner(request, env) {
    const user = await requireUserSession(request, env.DB);
    if (!user) {
        return { error: Response.json({ success: false, error: "Sesión no válida o caducada." }, { status: 401, headers }) };
    }
    return { user };
}

// La Pi crea esta solicitud usando sólo el correo que el operador ya
// seleccionó. No concede acceso: el dueño debe verla y aprobarla en Link.
export async function pairingRequest(request, env) {
    try {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const deviceUuid = String(body.device_uuid || "").trim();
        const alias = String(body.alias || "LigronPi").trim().slice(0, 120) || "LigronPi";
        const deviceType = String(body.tipo || "LigronPi").trim();
        const secret = String(body.pairing_secret || "").trim();
        if (!email || !isUuid(deviceUuid) || !isLigronPi(deviceType) || !isSecret(secret)) {
            return Response.json({ success: false, error: "Solicitud de vinculación de Pi inválida." }, { status: 400, headers });
        }
        const owner = await findUserByEmail(env.DB, email);
        if (!owner || String(owner.estado || "ACTIVO").toUpperCase() !== "ACTIVO") {
            return Response.json({ success: false, error: "La cuenta indicada no puede vincular esta Pi." }, { status: 404, headers });
        }
        const existingDevice = await findDeviceByUuid(env.DB, deviceUuid);
        if (existingDevice && Number(existingDevice.usuario_id) !== Number(owner.id)) {
            return Response.json({ success: false, error: "Esta Pi pertenece a otra cuenta." }, { status: 409, headers });
        }
        const secretHash = await credentialHash(secret);
        const existing = await env.DB.prepare(`
            SELECT pairing_id, state, expires_at, consumed_at
            FROM device_pairings
            WHERE device_uuid=?1 AND owner_user_id=?2 AND pairing_hash=?3
            LIMIT 1
        `).bind(deviceUuid, owner.id, secretHash).first();
        if (existing && !existing.consumed_at && String(existing.expires_at) > new Date().toISOString().slice(0, 19).replace("T", " ")) {
            return Response.json({ success: true, pairing_id: existing.pairing_id, state: existing.state, expires_at: existing.expires_at }, { headers });
        }
        const pairingId = `pair_${token()}`;
        const capabilities = body.network_capabilities && typeof body.network_capabilities === "object"
            ? JSON.stringify(body.network_capabilities) : null;
        await env.DB.prepare(`
            INSERT INTO device_pairings
                (pairing_id, device_uuid, owner_user_id, device_type, device_alias, pairing_hash, capabilities_json, state, created_at, expires_at, approved_at, consumed_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'PENDING', datetime('now'), datetime('now', '+15 minutes'), NULL, NULL)
            ON CONFLICT(device_uuid) DO UPDATE SET
                pairing_id=excluded.pairing_id,
                owner_user_id=excluded.owner_user_id,
                device_type=excluded.device_type,
                device_alias=excluded.device_alias,
                pairing_hash=excluded.pairing_hash,
                capabilities_json=excluded.capabilities_json,
                state='PENDING',
                created_at=datetime('now'),
                expires_at=datetime('now', '+15 minutes'),
                approved_at=NULL,
                consumed_at=NULL
        `).bind(pairingId, deviceUuid, owner.id, deviceType, alias, secretHash, capabilities).run();
        return Response.json({ success: true, pairing_id: pairingId, state: "PENDING", expires_in_seconds: 900 }, { headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}

export async function pairingList(request, env) {
    const auth = await pairingOwner(request, env);
    if (auth.error) return auth.error;
    try {
        const rows = await env.DB.prepare(`
            SELECT pairing_id, device_uuid, device_alias, created_at, expires_at, state
            FROM device_pairings
            WHERE owner_user_id=?1 AND consumed_at IS NULL AND datetime(expires_at) > datetime('now')
            ORDER BY created_at DESC
        `).bind(auth.user.id).all();
        return Response.json({ success: true, pairings: rows.results || [] }, { headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}

export async function pairingApprove(request, env, pairingId) {
    const auth = await pairingOwner(request, env);
    if (auth.error) return auth.error;
    try {
        const pairing = await env.DB.prepare(`
            SELECT * FROM device_pairings
            WHERE pairing_id=?1 AND owner_user_id=?2 AND state='PENDING'
              AND consumed_at IS NULL AND datetime(expires_at) > datetime('now')
            LIMIT 1
        `).bind(pairingId, auth.user.id).first();
        if (!pairing) {
            return Response.json({ success: false, error: "La solicitud de vinculación ya no está disponible." }, { status: 404, headers });
        }
        const existingDevice = await findDeviceByUuid(env.DB, pairing.device_uuid);
        if (existingDevice && Number(existingDevice.usuario_id) !== Number(auth.user.id)) {
            return Response.json({ success: false, error: "Esta Pi pertenece a otra cuenta." }, { status: 409, headers });
        }
        await registerOrUpdateDevice(env.DB, {
            usuarioId: auth.user.id,
            tipo: pairing.device_type,
            alias: pairing.device_alias,
            uuid: pairing.device_uuid,
            publicIp: null,
            ultimaConexion: new Date().toISOString(),
            estado: "ONLINE"
        });
        if (pairing.capabilities_json) {
            try {
                await env.DB.prepare(`INSERT INTO device_network_capabilities (device_uuid, capabilities_json, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(device_uuid) DO UPDATE SET capabilities_json=excluded.capabilities_json, updated_at=datetime('now')`)
                    .bind(pairing.device_uuid, pairing.capabilities_json).run();
            } catch (_) {
                // La tabla se crea en instalaciones recientes; la vinculación
                // no debe fallar si una cuenta aún no publicó capacidades.
            }
        }
        await env.DB.prepare(`
            UPDATE device_pairings
            SET state='APPROVED', approved_at=datetime('now')
            WHERE pairing_id=?1 AND state='PENDING' AND consumed_at IS NULL
        `).bind(pairingId).run();
        return Response.json({ success: true, state: "APPROVED" }, { headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}

export async function pairingComplete(request, env) {
    try {
        const body = await request.json();
        const pairingId = String(body.pairing_id || "").trim();
        const deviceUuid = String(body.device_uuid || "").trim();
        const secret = String(body.pairing_secret || "").trim();
        if (!/^pair_[A-Za-z0-9_-]{24,}$/.test(pairingId) || !isUuid(deviceUuid) || !isSecret(secret)) {
            return Response.json({ success: false, error: "Confirmación de vinculación inválida." }, { status: 400, headers });
        }
        const pairing = await env.DB.prepare(`
            SELECT state, expires_at, consumed_at
            FROM device_pairings
            WHERE pairing_id=?1 AND device_uuid=?2 AND pairing_hash=?3
            LIMIT 1
        `).bind(pairingId, deviceUuid, await credentialHash(secret)).first();
        if (!pairing) {
            return Response.json({ success: false, error: "La solicitud de vinculación no es válida." }, { status: 401, headers });
        }
        if (pairing.consumed_at || String(pairing.state) === "CONSUMED") {
            return Response.json({ success: false, code: "PAIRING_ALREADY_CONSUMED", error: "La vinculación ya fue consumida; solicita una nueva si la Pi no terminó de configurarse." }, { status: 409, headers });
        }
        if (String(pairing.expires_at) <= new Date().toISOString().slice(0, 19).replace("T", " ")) {
            return Response.json({ success: false, code: "PAIRING_EXPIRED", error: "La solicitud de vinculación ha caducado." }, { status: 410, headers });
        }
        if (String(pairing.state) !== "APPROVED") {
            return Response.json({ success: true, state: "PENDING" }, { headers });
        }
        const claim = await env.DB.prepare(`
            UPDATE device_pairings
            SET state='CONSUMED', consumed_at=datetime('now')
            WHERE pairing_id=?1 AND state='APPROVED' AND consumed_at IS NULL
              AND datetime(expires_at) > datetime('now')
        `).bind(pairingId).run();
        if (Number(claim.meta?.changes || 0) !== 1) {
            return Response.json({ success: true, state: "PENDING" }, { headers });
        }
        const identity = await issueDeviceIdentity(env.DB, deviceUuid);
        return Response.json({
            success: true,
            state: "ACTIVE",
            device_credential: identity.deviceCredential,
            recovery_credential: identity.recoveryCredential
        }, { headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}
