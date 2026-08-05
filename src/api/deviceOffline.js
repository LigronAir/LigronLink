// ==========================================================
// LigronLink
// API - Marcar Equipo como OFFLINE
// src/api/deviceOffline.js
// ==========================================================

import { setDeviceStatus } from "../database/devices.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// ==========================================================
// POST /api/v1/device/offline
// ==========================================================

export async function deviceOffline(request, env) {

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

        const uuid = body.uuid?.trim() || "";

        // --------------------------------------------------
        // Validaciones
        // --------------------------------------------------

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
        // Marcar OFFLINE
        // --------------------------------------------------

        // ### FIX
        // Actualiza únicamente el estado de presencia
        // del dispositivo. No modifica identidad,
        // usuario, alias ni dirección IP.

        await setDeviceStatus(
            env.DB,
            uuid,
            "OFFLINE"
        );

        // --------------------------------------------------
        // OK
        // --------------------------------------------------

        return Response.json(

            {
                success: true,
                status: "OFFLINE"
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