// ==========================================================
// LigronLink
// API - Obtener equipos del usuario
// ==========================================================

import { findDevicesByUser } from "../database/devices.js";

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
        // Usuario provisional
        // --------------------------------------------------

        const usuarioId = 1;

        // --------------------------------------------------
        // Obtener equipos
        // --------------------------------------------------

        const devices = await findDevicesByUser(

            env.DB,
            usuarioId

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