// ==========================================================
// LigronLink
// API - Registrar Equipo
// ==========================================================

// ### FIX
import { findUserByEmail } from "../database/users.js";
import { registerOrUpdateDevice } from "../database/devices.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// ==========================================================
// POST /api/v1/device/register
// ==========================================================

export async function deviceRegister(request, env) {

    try {

        // --------------------------------------------------
        // Solo POST
        // --------------------------------------------------

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

        // --------------------------------------------------
        // Leer JSON
        // --------------------------------------------------

        const body = await request.json();

        const tipo = body.tipo?.trim();

        const alias = body.alias?.trim();

        const uuid = body.uuid?.trim() || "";

        const email = body.email?.trim().toLowerCase() || "";

        // ==================================================
        // ### FIX
        // Cloudflare conoce la IP pública real desde la que
        // llega la conexión.
        // ==================================================

        const publicIp =
            request.headers.get("CF-Connecting-IP") || "";

        // --------------------------------------------------
        // Validaciones
        // --------------------------------------------------

        if (!tipo) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar el tipo de equipo."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        if (!alias) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar un alias."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        if (!uuid) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar un UUID."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        // --------------------------------------------------
        // Usuario
        // --------------------------------------------------

        let usuarioId = 1;

        // ### FIX
        // Si Native envía email, se usa el usuario real.
        // Si no llega email, se conserva el comportamiento
        // provisional/manual existente.
        if (email) {

            const usuario = await findUserByEmail(env.DB, email);

            if (!usuario) {

                return Response.json(
                    {
                        success: false,
                        error: "No se pudo resolver el usuario autenticado."
                    },
                    {
                        status: 401,
                        headers: corsHeaders
                    }
                );

            }

            usuarioId = usuario.id;

        }

        // --------------------------------------------------
        // Registrar o actualizar equipo
        // --------------------------------------------------

        const esNative = Boolean(email);

        const resultado = await registerOrUpdateDevice(
            env.DB,
            {
                usuarioId,
                tipo,
                alias,
                uuid,

                // ### FIX
                publicIp: esNative ? publicIp : null,

                // ### FIX
                ultimaConexion: esNative ? new Date().toISOString() : null,

                // ### FIX
                estado: esNative ? "ONLINE" : "OFFLINE"
            }
        );

        // --------------------------------------------------
        // OK
        // --------------------------------------------------

        return Response.json(

            {
                success: true,

                // ### FIX
                connected: esNative,

                // ### FIX
                publicIp: esNative ? publicIp : null,

                created: resultado.created,
                updated: resultado.updated

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