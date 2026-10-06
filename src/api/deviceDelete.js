// ==========================================================
// LigronLink
// API - Eliminar equipo
// ==========================================================

import { deleteDevice } from "../database/devices.js";
import { requireUserSession } from "../security/sessions.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// ==========================================================
// DELETE /api/v1/device/:id
// ==========================================================

export async function deviceDelete(request, env) {

    try {

        // --------------------------------------------------
        // Obtener parámetros
        // --------------------------------------------------

        const url = new URL(request.url);

        const partes =
            url.pathname.split("/");

        const deviceId =
            Number(partes[4]);

        if (!deviceId) {

            return Response.json(

                {

                    success: false,

                    error: "ID de equipo no válido."

                },

                {

                    status: 400,

                    headers: corsHeaders

                }

            );

        }

        const usuario = await requireUserSession(request, env.DB);

        if (!usuario) {

            return Response.json(

                {

                    success: false,

                    error: "Sesión no válida o caducada. Inicie sesión de nuevo."

                },

                {

                    status: 401,

                    headers: corsHeaders

                }

            );

        }

        // --------------------------------------------------
        // Eliminar equipo
        // --------------------------------------------------

        await deleteDevice(

            env.DB,

            deviceId,

            usuario.id

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
