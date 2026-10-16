// ==========================================================
// LigronLink - recuperación segura de una LigronPi revocada
// ==========================================================

import { findDeviceByUuid } from "../database/devices.js";
import {
    credentialHash,
    issueDeviceRecoveryCredential,
    requireDeviceCredential,
    requireDeviceRecoveryCredential
} from "../security/deviceCredentials.js";

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

function newToken(bytes = 32) {
    const value = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...value))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
}

// POST /api/v1/device/recovery
// La recovery credential no es una llave de acceso: únicamente consume una
// autorización de un propietario que aún esté vigente. Sin esa fila devuelve
// 403 y no realiza ninguna escritura en D1.
export async function deviceRecovery(request, env) {
    try {
        const body = await request.json();
        const deviceUuid = String(body.device_uuid || "").trim();
        const recovery = await requireDeviceRecoveryCredential(request, env.DB, deviceUuid);
        const device = recovery && await findDeviceByUuid(env.DB, deviceUuid);
        if (!device || !isLigronPi(device)) {
            return Response.json({
                success: false,
                code: "RECOVERY_AUTH_FAILED",
                error: "La identidad de recuperación de esta Pi no es válida."
            }, { status: 401, headers });
        }

        // Se reclama antes de emitir nada. Dos reintentos concurrentes no
        // pueden consumir la misma autorización y rotar el token de la Pi.
        const claim = await env.DB.prepare(`
            UPDATE device_recovery_authorizations
            SET consumed_at=datetime('now')
            WHERE device_uuid=?1
              AND consumed_at IS NULL
              AND datetime(expires_at) > datetime('now')
        `).bind(deviceUuid).run();
        if (Number(claim.meta?.changes || 0) !== 1) {
            return Response.json({
                success: false,
                code: "OWNER_AUTHORIZATION_REQUIRED",
                error: "Esta Pi espera la autorización del propietario en LigronLink."
            }, { status: 403, headers });
        }

        const deviceCredential = newToken();
        await env.DB.batch([
            env.DB.prepare(`
                INSERT INTO device_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
                VALUES (?1, ?2, datetime('now'), datetime('now'), NULL)
                ON CONFLICT(device_uuid) DO UPDATE SET
                    token_hash=excluded.token_hash,
                    created_at=datetime('now'),
                    last_used_at=datetime('now'),
                    revoked_at=NULL
            `).bind(deviceUuid, await credentialHash(deviceCredential)),
            env.DB.prepare(`
                UPDATE device_recovery_credentials
                SET last_used_at=datetime('now')
                WHERE device_uuid=?1
            `).bind(deviceUuid),
            // Conservamos la autorización consumida como auditoría breve.
            // `consumed_at` ya bloqueó cualquier segundo canje.
        ]);
        return Response.json({ success: true, device_credential: deviceCredential }, { headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}

// POST /api/v1/device/recovery/identity
// Permite que una Pi ya operativa de una versión anterior obtenga, una única
// vez, su recovery credential. Es seguro porque exige la Device credential
// activa; no usa correo ni UUID como prueba de identidad.
export async function deviceRecoveryIdentity(request, env) {
    try {
        const body = await request.json();
        const deviceUuid = String(body.device_uuid || "").trim();
        const credential = await requireDeviceCredential(request, env.DB, deviceUuid, { touch: true });
        const device = credential && await findDeviceByUuid(env.DB, deviceUuid);
        if (!device || !isLigronPi(device)) {
            return Response.json({
                success: false,
                code: "DEVICE_AUTH_FAILED",
                error: "La credencial de esta Pi no es válida."
            }, { status: 401, headers });
        }
        const recoveryCredential = await issueDeviceRecoveryCredential(env.DB, deviceUuid);
        return Response.json({ success: true, recovery_credential: recoveryCredential }, { headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}
