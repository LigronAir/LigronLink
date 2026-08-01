// ==========================================================
// LigronLink
// API - Eliminar equipo
// ==========================================================

import { deleteDevice } from "../database/devices.js";
import { findUserByEmail } from "../database/users.js";

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
        // Obtener parámetros
        // --------------------------------------------------

        const url = new URL(request.url);

        const partes =
            url.pathname.split("/");

        const deviceId =
            Number(partes[4]);

        const email =
            url.searchParams
                .get("email")
                ?.trim()
                .toLowerCase();

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