// ==========================================================
// LigronLink
// API - Registrar Equipo
// ==========================================================

// ### FIX
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

        // ### FIX
        // Preparado para futuras autenticaciones desde Native.
        // De momento se mantiene exactamente el comportamiento
        // actual utilizando el usuario provisional.
        const email = body.email?.trim() || "";

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
        // Usuario provisional
        // --------------------------------------------------

        const usuarioId = 1;

        // ### FIX
        // Variable preparada para futuras versiones donde
        // el usuario se resolverá mediante autenticación.
        void email;

        // --------------------------------------------------
        // Registrar o actualizar equipo
        // --------------------------------------------------

        const resultado = await registerOrUpdateDevice(
            env.DB,
            {
                usuarioId,
                tipo,
                alias,
                uuid
            }
        );

        // --------------------------------------------------
        // OK
        // --------------------------------------------------

        return Response.json(

            {
                success: true,

                // ### FIX
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