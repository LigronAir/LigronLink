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
    "CONNECTING",
    "RECONNECTING",
    "EMITTING",
    "ERROR"
];

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

        try {

            await updateDeviceRuntimeStatus(
                env.DB,
                device,
                {
                    runtime_state: runtimeState,
                    source_label: String(body.source_label || "").trim(),
                    target_device_uuid: String(body.target_device_uuid || "").trim(),
                    target_label: String(body.target_label || "").trim(),
                    target_srt_url: String(body.target_srt_url || "").trim(),
                    streaming: Boolean(body.streaming),
                    pipeline_active: Boolean(body.pipeline_active),
                    signal_available: Boolean(body.signal_available),
                    audio_state: String(body.audio_state || "").trim().toUpperCase()
                }
            );

        }
        catch (error) {

            if (!isMissingRuntimeStatusTable(error)) {
                throw error;
            }

            runtimeStatusAvailable = false;
            console.warn(
                "device_runtime_status aún no existe; presencia actualizada sin runtime."
            );

        }

        return Response.json(
            {
                success: true,
                runtime_status_available: runtimeStatusAvailable,
                network_status_available: networkStatusAvailable,
                peer: await findTargetPresence(
                    env.DB,
                    usuario.id,
                    String(body.target_device_uuid || "").trim(),
                    device.uuid
                )
            },
            {
                headers: corsHeaders
            }
        );

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
