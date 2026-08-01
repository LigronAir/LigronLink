// ==========================================================
// LigronLink
// API - Obtener equipos del usuario
// ==========================================================

import { findDevicesByUser } from "../database/devices.js";

// ### FIX
import { findUserByEmail } from "../database/users.js";

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

        const devices =
            await findDevicesByUser(
                env.DB,
                usuario.id
            );

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