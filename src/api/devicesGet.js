// ==========================================================
// LigronLink
// API - Obtener equipos del usuario
// ==========================================================

import { findDevicesByUser } from "../database/devices.js";

// ### FIX
import { findUserByEmail } from "../database/users.js";

// ### FIX
import { findSrtReceiverSummaryByUser } from "../database/srtDestinations.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// ==========================================================
// GET /api/v1/devices
// ==========================================================

export async function devicesGet(request, env) {

    try {

        // --------------------------------------------------
        // ### FIX
        // Obtener email desde la URL
        // --------------------------------------------------

        const url = new URL(request.url);

        const email =
            url.searchParams
                .get("email")
                ?.trim()
                .toLowerCase();

        if (!email) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar el correo."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        // --------------------------------------------------
        // ### FIX
        // Resolver usuario
        // --------------------------------------------------

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

        // --------------------------------------------------
        // Obtener equipos
        // --------------------------------------------------

        const devicesRaw =
            await findDevicesByUser(
                env.DB,
                usuario.id
            );

        // ### FIX
        // Añadir estado agregado de receptores SRT para que la web
        // pueda visualizar disponibilidad real de Native sin pedir
        // al operador que entre en LigronPi.
        const srtRows =
            await findSrtReceiverSummaryByUser(
                env.DB,
                usuario.id
            );

        const srtByDevice =
            new Map(
                srtRows.map((row) => [
                    row.equipo_uuid,
                    {
                        total: Number(row.total || 0),
                        free: Number(row.free || 0),
                        busy: Number(row.busy || 0),
                        reserved: Number(row.reserved || 0),
                        offline: Number(row.offline || 0),
                        last_update: row.last_update || null
                    }
                ])
            );

        const devices =
            devicesRaw.map((device) => ({
                ...device,
                srt_receivers:
                    srtByDevice.get(device.uuid) || {
                        total: 0,
                        free: 0,
                        busy: 0,
                        reserved: 0,
                        offline: 0,
                        last_update: null
                    }
            }));

        // --------------------------------------------------
        // Respuesta
        // --------------------------------------------------

        return Response.json(

            {

                success: true,

                devices

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
