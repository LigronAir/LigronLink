// ==========================================================
// LigronLink
// API - Estado runtime de equipos
// ==========================================================

import {
    findDeviceByUuid,
    touchDevicePresence,
    updateDeviceRuntimeStatus
} from "../database/devices.js";
import { findUserByEmail } from "../database/users.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

const VALID_STATES = [
    "OFFLINE",
    "MONITOR",
    "CONNECTING",
    "EMITTING",
    "ERROR"
];

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

        // Un estado runtime válido también es un heartbeat del equipo.
        await touchDevicePresence(
            env.DB,
            device.uuid,
            usuario.id
        );

        return Response.json(
            {
                success: true
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
