// ==========================================================
// LigronLink
// API - Obtener destinos SRT disponibles
// ==========================================================

import { findUserByEmail } from "../database/users.js";
import {
    findAvailableSrtDestinations,
    findAvailableSrtDevices
} from "../database/srtDestinations.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// ==========================================================
// Construir URL SRT para un receptor listener.
// ==========================================================

function buildSrtUrl(host, port, mode) {

    const normalizedHost =
        String(host).includes(":") && !String(host).startsWith("[")
            ? `[${host}]`
            : host;

    const queryMode =
        mode === "listener"
            ? "caller"
            : "caller";

    return `srt://${normalizedHost}:${port}?mode=${queryMode}`;

}

// ==========================================================
// GET /api/v1/srt/destinations
// ==========================================================

export async function srtDestinations(request, env) {

    try {

        // --------------------------------------------------
        // Solo GET
        // --------------------------------------------------

        if (request.method !== "GET") {

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
        // Email
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
        // Obtener destinos utilizables
        // --------------------------------------------------

        // ### FIX
        // La UI de LigronPi debe elegir equipos, no mochilas.
        const deviceRows =
            await findAvailableSrtDevices(
                env.DB,
                usuario.id
            );

        const devices =
            deviceRows.map((row) => ({
                device_uuid: row.equipo_uuid,
                device_alias: row.device_alias,
                available_receivers: Number(row.available_receivers || 0)
            }));

        // ### FIX
        // Campo técnico conservado por compatibilidad temporal.
        // LigronPi nuevo no debe usarlo para la selección del operador.
        const rows =
            await findAvailableSrtDestinations(
                env.DB,
                usuario.id
            );

        const destinations =
            rows.map((row) => ({
                id: row.id,
                device_uuid: row.equipo_uuid,
                device_alias: row.device_alias,
                source_id: row.source_id,
                name: row.nombre,
                host: row.host,
                port: row.port,
                mode: row.mode,
                state: row.estado,
                srt_url: buildSrtUrl(
                    row.host,
                    row.port,
                    row.mode
                )
            }));

        // --------------------------------------------------
        // OK
        // --------------------------------------------------

        return Response.json(
            {
                success: true,
                // ### FIX
                devices,
                destinations
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
