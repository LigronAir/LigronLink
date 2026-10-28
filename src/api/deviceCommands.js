import { findDeviceByUuid } from "../database/devices.js";
import { advancePoolSwitch } from "./poolClaim.js";
import { requireUserSession } from "../security/sessions.js";
import { requireDeviceCredential } from "../security/deviceCredentials.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// Primera fase segura. Reiniciar sistema, actualizar paquetes o cambiar una
// Wi-Fi (que exigiría transportar una contraseña) no entran en esta cola.
const ALLOWED_COMMANDS = new Set([
    "stream_start", "stream_stop", "pipeline_restart", "wifi_scan", "status_refresh", "bond_set", "stream_tune", "hotswap_commit", "hotswap_rollback", "pool_claim", "pool_move",
    // Soporte remoto con acciones cerradas. La Pi inicia siempre la conexión
    // HTTPS; no se expone SSH, shell ni parámetros de sistema por Link.
    "support_tail_retry", "support_diagnostics"
]);

function response(payload, status = 200) {
    return Response.json(payload, { status, headers: corsHeaders });
}

// Una credencial de equipo sólo autoriza a su propio UUID y a su cuenta.
async function credentialDevice(env, request, uuidValue) {
    const uuid = String(uuidValue || "").trim();
    if (!uuid) return { error: "Debe indicar el UUID de equipo.", status: 400 };
    const credential = await requireDeviceCredential(request, env.DB, uuid);
    if (!credential) return { error: "Credencial de equipo no válida.", status: 401 };
    const device = await findDeviceByUuid(env.DB, uuid);
    if (!device) return { error: "Equipo no encontrado.", status: 404 };
    const user = await env.DB.prepare(`
        SELECT id, email, nombre, estado FROM usuarios
        WHERE id=?1 AND UPPER(COALESCE(estado, 'ACTIVO'))='ACTIVO'
        LIMIT 1
    `).bind(device.usuario_id).first();
    if (!user) return { error: "La cuenta operativa del equipo no está disponible.", status: 403 };
    return { user, device, uuid };
}

function hasDeviceAuthorization(request) {
    return /^Device\s+/i.test(String(request.headers.get("Authorization") || ""));
}

async function authenticatedDevice(env, request, uuidValue) {
    const uuid = String(uuidValue || "").trim();
    if (!uuid) return { error: "Debe indicar el UUID de equipo.", status: 400 };
    if (hasDeviceAuthorization(request)) {
        return credentialDevice(env, request, uuid);
    }
    const user = await requireUserSession(request, env.DB);
    if (!user) return { error: "Se necesita una sesión o credencial de equipo válida.", status: 401 };
    const device = await findDeviceByUuid(env.DB, uuid);
    if (!device || Number(device.usuario_id) !== Number(user.id)) {
        return { error: "Equipo no disponible para esta sesión.", status: 403 };
    }
    return { user, device, uuid };
}

function isNative(device) {
    return ["ligronair", "ligronair native", "ligronair_native"]
        .includes(String(device?.tipo || "").trim().toLowerCase());
}

export async function deviceCommands(request, env) {
    try {
        if (request.method === "POST") {
            const body = await request.json();
            const sender = await authenticatedDevice(env, request, body.device_uuid);
            if (sender.error) return response({ success: false, error: sender.error }, sender.status);
            if (!isNative(sender.device)) {
                return response({ success: false, error: "Sólo un LigronAir Native puede enviar órdenes remotas." }, 403);
            }

            const targetUuid = String(body.target_device_uuid || "").trim();
            const command = String(body.command || "").trim().toLowerCase();
            if (!targetUuid || !ALLOWED_COMMANDS.has(command)) {
                return response({ success: false, error: "Orden remota no permitida." }, 400);
            }
            const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
                ? body.payload : {};
            if (command === "bond_set" && (
                !/^[A-Za-z0-9_.:-]{1,64}$/.test(String(payload.interface_key || "")) ||
                typeof payload.enabled !== "boolean"
            )) {
                return response({ success: false, error: "Cambio de bonding inválido." }, 400);
            }
            if (command === "stream_tune" && (
                !Number.isInteger(payload.bitrate_kbps) || payload.bitrate_kbps < 500 || payload.bitrate_kbps > 12000 ||
                !Number.isInteger(payload.latency_ms) || payload.latency_ms < 50 || payload.latency_ms > 10000
            )) {
                return response({ success: false, error: "Bitrate o latencia fuera del rango operativo." }, 400);
            }

            const target = await findDeviceByUuid(env.DB, targetUuid);
            if (!target || Number(target.usuario_id) !== Number(sender.user.id)) {
                return response({ success: false, error: "Pi remota no disponible para esta cuenta." }, 404);
            }

            // El emisor debe estar ligado a este Native. Una reserva Link es
            // una prueba válida; una sesión SRT activa resuelta contra la IP
            // Tailnet y el puerto del Native también lo es. Así el remoto no
            // se rompe cuando la llegada directa por Tailnet ya puso la caja
            // BUSY antes de que exista una reserva persistida.
            const pair = await env.DB.prepare(`
                SELECT 'RESERVATION' AS proof
                WHERE EXISTS (
                    SELECT 1 FROM srt_destinos
                    WHERE usuario_id=?1 AND equipo_uuid=?2
                      AND reservado_por_uuid=?3 AND estado IN ('RESERVED','BUSY')
                )
                UNION ALL
                SELECT 'ACTIVE_TAIL_SESSION' AS proof
                WHERE EXISTS (
                    SELECT 1
                    FROM device_runtime_status AS r
                    JOIN equipos AS pi
                      ON pi.uuid=r.device_uuid AND pi.usuario_id=r.usuario_id
                    WHERE r.usuario_id=?1
                      AND r.device_uuid=?3
                      AND r.target_device_uuid=?2
                      AND r.streaming=1
                      AND UPPER(pi.estado)='ONLINE'
                      AND datetime(pi.ultima_conexion)>=datetime('now','-75 seconds')
                      AND datetime(r.ultima_actualizacion)>=datetime('now','-75 seconds')
                )
                LIMIT 1
            `).bind(sender.user.id, sender.uuid, targetUuid).first();
            const isSupportCommand = command === "support_tail_retry" || command === "support_diagnostics";
            if (!pair && !isSupportCommand) {
                return response({ success: false, error: "La Pi no está asociada a una caja de este Native." }, 409);
            }

            const id = crypto.randomUUID();
            await env.DB.prepare(`
                INSERT INTO device_remote_commands
                    (id, usuario_id, sender_device_uuid, target_device_uuid, command, payload_json, expires_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now','+3 minutes'))
            `).bind(id, sender.user.id, sender.uuid, targetUuid, command, JSON.stringify(payload)).run();
            return response({ success: true, command_id: id, state: "PENDING" });
        }

        if (request.method === "GET") {
            const url = new URL(request.url);
            const receiver = await authenticatedDevice(env, request, url.searchParams.get("device_uuid"));
            if (receiver.error) return response({ success: false, error: receiver.error }, receiver.status);
            const rows = await env.DB.prepare(`
                SELECT id, command, payload_json, created_at FROM device_remote_commands
                WHERE usuario_id=?1 AND target_device_uuid=?2 AND state='PENDING'
                  AND datetime(expires_at) > datetime('now')
                ORDER BY created_at ASC LIMIT 4
            `).bind(receiver.user.id, receiver.uuid).all();
            return response({ success: true, commands: rows.results || [] });
        }

        return response({ success: false, error: "Método no permitido." }, 405);
    } catch (error) {
        return response({ success: false, error: String(error?.message || error) }, 500);
    }
}

export async function deviceCommandResult(request, env) {
    try {
        if (request.method !== "POST") return response({ success: false, error: "Método no permitido." }, 405);
        const body = await request.json();
        const receiver = await authenticatedDevice(env, request, body.device_uuid);
        if (receiver.error) return response({ success: false, error: receiver.error }, receiver.status);
        const id = String(body.command_id || "").trim();
        const state = String(body.state || "").trim().toUpperCase();
        const result = String(body.result || "").trim().slice(0, 500);
        if (!id || !["COMPLETED", "FAILED"].includes(state)) {
            return response({ success: false, error: "Resultado remoto inválido." }, 400);
        }
        const updated = await env.DB.prepare(`
            UPDATE device_remote_commands
            SET state=?1, result_message=?2, completed_at=datetime('now')
            WHERE id=?3 AND usuario_id=?4 AND target_device_uuid=?5 AND state='PENDING'
        `).bind(state, result, id, receiver.user.id, receiver.uuid).run();
        const changed = Number(updated.meta?.changes || 0) > 0;
        // Sólo un ACK válido hace avanzar una transición Pool. El resultado
        // llega por la misma conexión HTTPS saliente de la Pi, sin abrir
        // puertos ni añadir consultas de polling al dashboard.
        if (changed) {
            await advancePoolSwitch(env, receiver.user.id, id, state, result);
        }
        return response({ success: true, updated: changed });
    } catch (error) {
        return response({ success: false, error: String(error?.message || error) }, 500);
    }
}
