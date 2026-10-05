// ==========================================================
// LigronLink
// API - Estado runtime de equipos
// ==========================================================

import {
    findDeviceByUuid,
    setDeviceStatus,
    touchDevicePresence,
    updateDeviceRuntimeStatus
} from "../database/devices.js";
import { findUserByEmail } from "../database/users.js";
import { findTargetPresence } from "../database/peerStatus.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

const VALID_STATES = [
    "OFFLINE",
    "MONITOR",
    "PREPARING",
    "CONNECTING",
    "RECONNECTING",
    "EMITTING",
    "ERROR"
];

// Los Native antiguos enviaban este mismo heartbeat de red cada 5 s, además
// del snapshot de receptores. Se coalescen en el borde 20 s; Pi nunca entra
// aquí porque su estado/telemetría forma parte del control operativo.
const NATIVE_HEARTBEAT_DEDUP_MS = 20 * 1000;
const nativeHeartbeatCache = new Map();

function nativeHeartbeatKey(body, email, uuid) {
    const state = String(body.runtime_state || body.state || "").trim().toUpperCase();
    const source = String(body.source_label || "").trim().toLowerCase();
    const target = String(body.target_device_uuid || "").trim();
    if (state !== "MONITOR" || !source.includes("ligronair native") || target) {
        return "";
    }
    try {
        return `${email}:${uuid}:${JSON.stringify(body.network_capabilities || {})}`;
    } catch {
        return "";
    }
}

function cachedNativeHeartbeat(key) {
    if (!key) return null;
    const entry = nativeHeartbeatCache.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
        if (entry) nativeHeartbeatCache.delete(key);
        return null;
    }
    return entry.payload;
}

function cacheNativeHeartbeat(key, payload) {
    if (!key) return;
    nativeHeartbeatCache.set(key, {
        payload,
        expiresAt: Date.now() + NATIVE_HEARTBEAT_DEDUP_MS
    });
    if (nativeHeartbeatCache.size > 128) {
        const oldest = nativeHeartbeatCache.keys().next().value;
        if (oldest) nativeHeartbeatCache.delete(oldest);
    }
}

function isMissingRuntimeStatusTable(error) {

    return String(error?.message || error)
        .toLowerCase()
        .includes("no such table: device_runtime_status");

}

function isMissingNetworkCapabilitiesTable(error) {
    return String(error?.message || error)
        .toLowerCase()
        .includes("no such table: device_network_capabilities");
}

function isMissingTelemetryColumn(error) {
    return String(error?.message || error).toLowerCase().includes("telemetry_json");
}

function compactTelemetry(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    try {
        const normalized = JSON.parse(JSON.stringify(value));
        return JSON.stringify(normalized).length <= 4096 ? normalized : {};
    } catch {
        return {};
    }
}

function parseSrtTarget(value) {
    const raw = String(value || "").trim();
    if (!/^srt:\/\//i.test(raw)) return null;
    try {
        const url = new URL(raw);
        const host = String(url.hostname || "").trim().toLowerCase();
        const port = Number(url.port || 0);
        return host && Number.isInteger(port) && port > 0
            ? { host, port }
            : null;
    } catch {
        return null;
    }
}

// Resuelve una salida SRT que apunta a una IP privada Tailnet contra el
// Native y la caja publicados por esa misma cuenta. Se ejecuta sólo cuando
// Pi aún no conoce UUID de destino: no es un sondeo periódico.
async function resolveNativeTargetFromSrt(db, userId, targetUrl) {
    const target = parseSrtTarget(targetUrl);
    if (!target) return null;

    const selectWithCapabilities = `
        SELECT e.uuid AS device_uuid, e.alias AS device_alias,
               s.source_id, s.nombre AS receiver_name
        FROM equipos AS e
        JOIN srt_destinos AS s
          ON s.equipo_uuid=e.uuid AND s.usuario_id=e.usuario_id
        LEFT JOIN device_network_capabilities AS c
          ON c.device_uuid=e.uuid
        WHERE e.usuario_id=?1
          AND LOWER(TRIM(e.tipo)) IN ('ligronair','ligronair native','ligronair_native')
          AND UPPER(e.estado)='ONLINE'
          AND datetime(e.ultima_conexion)>=datetime('now','-75 seconds')
          AND s.port=?2
          AND s.estado IN ('FREE','BUSY','RESERVED')
          AND (
              LOWER(COALESCE(s.host,''))=?3
              OR LOWER(COALESCE(e.public_ip,''))=?3
              OR LOWER(COALESCE(json_extract(c.capabilities_json,'$.tailscale_ipv4_address'),''))=?3
              OR LOWER(COALESCE(json_extract(c.capabilities_json,'$.ipv4_address'),''))=?3
          )
        ORDER BY s.source_id ASC
        LIMIT 1
    `;
    try {
        return await db.prepare(selectWithCapabilities)
            .bind(userId, target.port, target.host).first();
    } catch (error) {
        if (!isMissingNetworkCapabilitiesTable(error)) throw error;
        // Durante una migración parcial sólo se puede resolver por el
        // endpoint publicado o la IP pública, nunca se adivina una relación.
        return await db.prepare(`
            SELECT e.uuid AS device_uuid, e.alias AS device_alias,
                   s.source_id, s.nombre AS receiver_name
            FROM equipos AS e
            JOIN srt_destinos AS s
              ON s.equipo_uuid=e.uuid AND s.usuario_id=e.usuario_id
            WHERE e.usuario_id=?1
              AND LOWER(TRIM(e.tipo)) IN ('ligronair','ligronair native','ligronair_native')
              AND UPPER(e.estado)='ONLINE'
              AND datetime(e.ultima_conexion)>=datetime('now','-75 seconds')
              AND s.port=?2
              AND s.estado IN ('FREE','BUSY','RESERVED')
              AND (
                  LOWER(COALESCE(s.host,''))=?3
                  OR LOWER(COALESCE(e.public_ip,''))=?3
              )
            ORDER BY s.source_id ASC
            LIMIT 1
        `).bind(userId, target.port, target.host).first();
    }
}

async function syncNetworkCapabilities(db, deviceUuid, capabilities) {
    if (!capabilities || typeof capabilities !== "object") return false;
    try {
        await db.prepare(`
            INSERT INTO device_network_capabilities
                (device_uuid, capabilities_json, updated_at)
            VALUES (?1, ?2, datetime('now'))
            ON CONFLICT(device_uuid) DO UPDATE SET
                capabilities_json=excluded.capabilities_json,
                updated_at=datetime('now')
            WHERE capabilities_json != excluded.capabilities_json
        `).bind(deviceUuid, JSON.stringify(capabilities)).run();
        return true;
    } catch (error) {
        if (!isMissingNetworkCapabilitiesTable(error)) throw error;
        return false;
    }
}

// ==========================================================
// POST /api/v1/device/status
// ==========================================================

export async function deviceStatus(request, env) {

    try {

        if (request.method !== "POST") {

            return Response.json(
                {
                    success: false,
                    error: "Método no permitido."
                },
                {
                    status: 405,
                    headers: corsHeaders
                }
            );

        }

        const body =
            await request.json();

        const email =
            String(body.email || "")
                .trim()
                .toLowerCase();

        const uuid =
            String(body.device_uuid || body.uuid || "")
                .trim();

        if (!email || !uuid) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar email y UUID de equipo."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        const heartbeatKey = nativeHeartbeatKey(body, email, uuid);
        const cachedHeartbeat = cachedNativeHeartbeat(heartbeatKey);
        if (cachedHeartbeat) {
            return Response.json(
                { ...cachedHeartbeat, heartbeat_cached: true },
                { headers: corsHeaders }
            );
        }

        const usuario =
            await findUserByEmail(
                env.DB,
                email
            );

        if (!usuario) {

            return Response.json(
                {
                    success: false,
                    error: "Usuario no encontrado."
                },
                {
                    status: 404,
                    headers: corsHeaders
                }
            );

        }

        const device =
            await findDeviceByUuid(
                env.DB,
                uuid
            );

        if (!device || Number(device.usuario_id) !== Number(usuario.id)) {

            return Response.json(
                {
                    success: false,
                    error: "Equipo no encontrado para este usuario."
                },
                {
                    status: 404,
                    headers: corsHeaders
                }
            );

        }

        const runtimeState =
            String(body.runtime_state || body.state || "OFFLINE")
                .trim()
                .toUpperCase();

        if (!VALID_STATES.includes(runtimeState)) {

            return Response.json(
                {
                    success: false,
                    error: "Estado runtime inválido."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        const requestedTargetUuid =
            String(body.target_device_uuid || "").trim();
        const requestedTargetUrl =
            String(body.target_srt_url || "").trim();
        const resolvingStates = new Set([
            "CONNECTING",
            "RECONNECTING",
            "EMITTING"
        ]);
        const resolvedTarget = !requestedTargetUuid &&
            resolvingStates.has(runtimeState)
            ? await resolveNativeTargetFromSrt(
                env.DB,
                usuario.id,
                requestedTargetUrl
            )
            : null;
        const effectiveTargetUuid =
            requestedTargetUuid ||
            String(resolvedTarget?.device_uuid || "").trim();
        const effectiveTargetLabel = resolvedTarget
            ? `Native ${String(resolvedTarget.device_alias || "LigronAir").trim()} · Caja ${String(resolvedTarget.source_id).padStart(2, "0")}`
            : String(body.target_label || "").trim();

        // OFFLINE is an explicit shutdown signal, not a heartbeat.  The
        // previous implementation touched presence even for OFFLINE, which
        // made a closed Pi appear alive for a new reservation.
        if (runtimeState === "OFFLINE") {
            await setDeviceStatus(env.DB, device.uuid, "OFFLINE");
        } else {
            await touchDevicePresence(env.DB, device.uuid, usuario.id);
        }

        // Pi envía esta fotografía con su heartbeat. Es información de
        // control; no lleva vídeo ni secretos de Tailscale.
        const networkStatusAvailable = await syncNetworkCapabilities(
            env.DB,
            device.uuid,
            body.network_capabilities
        );

        let runtimeStatusAvailable = true;
        let telemetryStatusAvailable = true;

        try {

            await updateDeviceRuntimeStatus(
                env.DB,
                device,
                {
                    runtime_state: runtimeState,
                    source_label: String(body.source_label || "").trim(),
                    target_device_uuid: effectiveTargetUuid,
                    target_label: effectiveTargetLabel,
                    target_srt_url: requestedTargetUrl,
                    streaming: Boolean(body.streaming),
                    pipeline_active: Boolean(body.pipeline_active),
                    signal_available: Boolean(body.signal_available),
                    audio_state: String(body.audio_state || "").trim().toUpperCase(),
                    telemetry: compactTelemetry(body.telemetry)
                }
            );

        }
        catch (error) {

            if (isMissingTelemetryColumn(error)) {
                telemetryStatusAvailable = false;
                await updateDeviceRuntimeStatus(
                    env.DB,
                    device,
                    {
                        runtime_state: runtimeState,
                        source_label: String(body.source_label || "").trim(),
                        target_device_uuid: effectiveTargetUuid,
                        target_label: effectiveTargetLabel,
                        target_srt_url: requestedTargetUrl,
                        streaming: Boolean(body.streaming),
                        pipeline_active: Boolean(body.pipeline_active),
                        signal_available: Boolean(body.signal_available),
                        audio_state: String(body.audio_state || "").trim().toUpperCase()
                    },
                    false
                );
            } else if (!isMissingRuntimeStatusTable(error)) {
                throw error;
            } else {
                runtimeStatusAvailable = false;
                console.warn(
                    "device_runtime_status aún no existe; presencia actualizada sin runtime."
                );
            }

        }

        const responsePayload = {
                success: true,
                runtime_status_available: runtimeStatusAvailable,
                telemetry_status_available: telemetryStatusAvailable,
                network_status_available: networkStatusAvailable,
                resolved_target: resolvedTarget || null,
                peer: await findTargetPresence(
                    env.DB,
                    usuario.id,
                    effectiveTargetUuid,
                    device.uuid
                )
            };
        cacheNativeHeartbeat(heartbeatKey, responsePayload);
        return Response.json(responsePayload, { headers: corsHeaders });

    }
    catch (error) {

        console.error(error);

        return Response.json(
            {
                success: false,
                error: error.message
            },
            {
                status: 500,
                headers: corsHeaders
            }
        );

    }

}
