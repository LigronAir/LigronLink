// ==========================================================
// LigronLink
// API - Asignación automática de receptor SRT
// ==========================================================

import { findDeviceByUuid } from "../database/devices.js";
import { allocateSrtDestination } from "../database/srtDestinations.js";
import { findUserByEmail } from "../database/users.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// ==========================================================
// ### FIX
// Construir URL SRT para Pi caller.
// ==========================================================

function buildSrtUrl(host, port) {

    const normalizedHost =
        String(host).includes(":") && !String(host).startsWith("[")
            ? `[${host}]`
            : host;

    return `srt://${normalizedHost}:${port}?mode=caller`;

}

// ==========================================================
// POST /api/v1/srt/allocate
// ==========================================================

export async function srtAllocate(request, env) {

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
        // La Pi debe existir y pertenecer al mismo usuario.
        const pi =
            await findDeviceByUuid(
                env.DB,
                piUuid
            );

        if (
            !pi ||
            Number(pi.usuario_id) !== Number(usuario.id) ||
            !["ligronpi", "ligronpi native", "ligronpi_native"].includes(
                String(pi.tipo || "").trim().toLowerCase()
            )
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
        // El receptor Native debe existir, estar ONLINE y pertenecer al usuario.
        const device =
            await findDeviceByUuid(
                env.DB,
                deviceUuid
            );

        if (
            !device ||
            Number(device.usuario_id) !== Number(usuario.id) ||
            !["ligronair", "ligronair native", "ligronair_native"].includes(
                String(device.tipo || "").trim().toLowerCase()
            )
        ) {

            return Response.json(
                {
                    success: false,
                    error: "LigronAir no autorizado para este usuario."
                },
                {
                    status: 403,
                    headers: corsHeaders
                }
            );

        }

        if (String(device.estado || "").trim().toUpperCase() !== "ONLINE") {

            return Response.json(
                {
                    success: false,
                    error: "LigronAir no está ONLINE."
                },
                {
                    status: 409,
                    headers: corsHeaders
                }
            );

        }

        // ### FIX
        // Asignación atómica: un único UPDATE selecciona y reserva.
        const assignment =
            await allocateSrtDestination(
                env.DB,
                usuario.id,
                piUuid,
                deviceUuid
            );

        if (!assignment) {

            return Response.json(
                {
                    success: false,
                    error: "No hay receptores SRT libres en ese LigronAir."
                },
                {
                    status: 409,
                    headers: corsHeaders
                }
            );

        }

        return Response.json(
            {
                success: true,
                assignment: {
                    device_uuid: assignment.equipo_uuid,
                    srt_url: buildSrtUrl(
                        assignment.host,
                        assignment.port
                    ),

                    // ### FIX
                    // Campos técnicos para diagnóstico/log; no deben
                    // utilizarse como selección de operador.
                    source_id: assignment.source_id,
                    receiver_name: assignment.nombre,
                    port: assignment.port
                }
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
