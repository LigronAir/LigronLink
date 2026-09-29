// ==========================================================
// LigronLink
// API - Liberación de receptor SRT reservado
// ==========================================================

import { findDeviceByUuid } from "../database/devices.js";
import { releaseSrtDestination } from "../database/srtDestinations.js";
import { findUserByEmail } from "../database/users.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// ==========================================================
// POST /api/v1/srt/release
// ==========================================================

export async function srtRelease(request, env) {

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

        const body = await request.json();

        const email =
            body.email?.trim().toLowerCase() || "";

        const piUuid =
            body.pi_uuid?.trim() || "";

        const deviceUuid =
            body.device_uuid?.trim() || "";

        if (!email || !piUuid || !deviceUuid) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar email, pi_uuid y device_uuid."
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

        // ### FIX
        // Validación mínima de propiedad de la Pi.
        const pi =
            await findDeviceByUuid(
                env.DB,
                piUuid
            );

        if (
            !pi ||
            Number(pi.usuario_id) !== Number(usuario.id)
        ) {

            return Response.json(
                {
                    success: false,
                    error: "LigronPi no autorizado para este usuario."
                },
                {
                    status: 403,
                    headers: corsHeaders
                }
            );

        }

        // ### FIX
        // Idempotente: si no había reserva activa, changes será 0
        // pero la operación se considera correcta.
        const released =
            await releaseSrtDestination(
                env.DB,
                usuario.id,
                piUuid,
                deviceUuid
            );

        // Revocar la credencial del relay inmediatamente al liberar la caja.
        // La siguiente instantánea de Native restaurará su listener directo.
        try {
            await env.DB.prepare(`
                UPDATE relay_sessions
                SET state='RELEASED', updated_at=datetime('now')
                WHERE usuario_id=?1 AND pi_device_uuid=?2 AND native_device_uuid=?3
                  AND state='ACTIVE'
            `).bind(usuario.id, piUuid, deviceUuid).run();
        } catch (relayError) {
            // Backward-compatible rollout: releasing a traditional direct
            // booking must keep working until the relay schema is migrated.
            if (!String(relayError?.message || relayError).includes("no such table")) {
                throw relayError;
            }
        }

        return Response.json(
            {
                success: true,
                released
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
