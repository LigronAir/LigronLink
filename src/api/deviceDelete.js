// ==========================================================
// LigronLink
// API - Eliminar equipo
// ==========================================================

import { deleteDevice } from "../database/devices.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// ==========================================================
// DELETE /api/v1/device/:id
// ==========================================================

export async function deviceDelete(request, env) {

    try {

        // --------------------------------------------------
        // Usuario provisional
        // --------------------------------------------------

        const usuarioId = 1;

        // --------------------------------------------------
        // Obtener ID desde la URL
        // --------------------------------------------------

        const url = new URL(request.url);

        const partes = url.pathname.split("/");

        const deviceId = Number(partes[4]);

        if (!deviceId) {

            throw new Error(
                "ID de equipo no válido."
            );

        }

        // --------------------------------------------------
        // Eliminar equipo
        // --------------------------------------------------

        await deleteDevice(

            env.DB,
            deviceId,
            usuarioId

        );

        // --------------------------------------------------
        // Respuesta
        // --------------------------------------------------

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