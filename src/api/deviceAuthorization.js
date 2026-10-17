// ==========================================================
// LigronLink - autorización explícita de recuperación de Pi
// ==========================================================

import { findDeviceByUuid } from "../database/devices.js";
import { requireUserSession } from "../security/sessions.js";

const headers = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store"
};

function isLigronPi(device) {
    return ["ligronpi", "ligronpi native", "ligronpi_native"]
        .includes(String(device?.tipo || "").trim().toLowerCase());
}

// POST /api/v1/device/authorization
// Sólo el dueño autenticado puede permitir UNA recuperación durante diez
// minutos. No se entrega ni se muestra ningún secreto en el navegador.
export async function deviceAuthorization(request, env) {
    try {
        const user = await requireUserSession(request, env.DB);
        if (!user) {
            return Response.json({ success: false, error: "Sesión no válida o caducada." }, { status: 401, headers });
        }
        const body = await request.json();
        const deviceUuid = String(body.device_uuid || "").trim();
        const device = deviceUuid && await findDeviceByUuid(env.DB, deviceUuid);
        if (!device || Number(device.usuario_id) !== Number(user.id) || !isLigronPi(device)) {
            return Response.json({ success: false, error: "LigronPi no autorizada para esta cuenta." }, { status: 403, headers });
        }
        const recovery = await env.DB.prepare(`
            SELECT device_uuid FROM device_recovery_credentials
            WHERE device_uuid=?1 AND revoked_at IS NULL
            LIMIT 1
        `).bind(deviceUuid).first();
        if (!recovery) {
            return Response.json({
                success: false,
                code: "RECOVERY_IDENTITY_MISSING",
                error: "Esta Pi necesita completar una vinculación de Link una sola vez antes de poder autorizar recuperaciones automáticas."
            }, { status: 409, headers });
        }
        await env.DB.prepare(`
            INSERT INTO device_recovery_authorizations
                (device_uuid, authorized_by_user_id, created_at, expires_at)
            VALUES (?1, ?2, datetime('now'), datetime('now', '+10 minutes'))
            ON CONFLICT(device_uuid) DO UPDATE SET
                authorized_by_user_id=excluded.authorized_by_user_id,
                created_at=datetime('now'),
                expires_at=datetime('now', '+10 minutes'),
                consumed_at=NULL
        `).bind(deviceUuid, user.id).run();
        return Response.json({
            success: true,
            state: "AUTHORIZED",
            expires_in_seconds: 600
        }, { headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}
