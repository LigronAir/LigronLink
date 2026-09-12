// ==========================================================
// LigronLink
// API - Publicar receptores SRT
// ==========================================================

import { findUserByEmail } from "../database/users.js";
import {
    findDeviceByUuid,
    touchDevicePresence
} from "../database/devices.js";
import { replaceSrtDestinations } from "../database/srtDestinations.js";
import { findLinkedPiStatuses } from "../database/peerStatus.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// ==========================================================
// POST /api/v1/srt/receivers
// ==========================================================

export async function srtReceivers(request, env) {

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

        const email =
            body.email?.trim().toLowerCase() || "";

        const deviceUuid =
            body.device_uuid?.trim() || "";

        const receivers =
            Array.isArray(body.receivers)
                ? body.receivers
                : null;

        // --------------------------------------------------
        // Validaciones generales
        // --------------------------------------------------

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

        if (!deviceUuid) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar el UUID del equipo."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        if (!receivers) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar la lista de receptores."
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
        // Resolver equipo y comprobar pertenencia
        // --------------------------------------------------

        const device =
            await findDeviceByUuid(
                env.DB,
                deviceUuid
            );

        if (!device) {

            return Response.json(
                {
                    success: false,
                    error: "Equipo no encontrado."
                },
                {
                    status: 404,
                    headers: corsHeaders
                }
            );

        }

        if (device.usuario_id !== usuario.id) {

            return Response.json(
                {
                    success: false,
                    error: "El equipo no pertenece al usuario indicado."
                },
                {
                    status: 403,
                    headers: corsHeaders
                }
            );

        }

        // --------------------------------------------------
        // ### FIX
        // V1 solo acepta equipos receptores LigronAir.
        // --------------------------------------------------

        const tipo =
            String(device.tipo || "")
                .trim()
                .toLowerCase();

        if (
            ![
                "ligronair",
                "ligronair native",
                "ligronair_native"
            ].includes(tipo)
        ) {

            return Response.json(
                {
                    success: false,
                    error: "El equipo no es un receptor LigronAir compatible."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        // --------------------------------------------------
        // Normalizar y validar receptores
        // --------------------------------------------------

        const normalizados = [];
        const sourceIds = new Set();

        for (let index = 0; index < receivers.length; index += 1) {

            const receiver = receivers[index] || {};

            const sourceId = Number(receiver.source_id);

            const nombre =
                receiver.name?.trim()
                || `MOCHILA ${String(sourceId).padStart(2, "0")}`;

            const mode =
                receiver.mode?.trim().toLowerCase()
                || "listener";

            const estado =
                String(receiver.state || "FREE")
                    .trim()
                    .toUpperCase();

            const hostRecibido =
                receiver.host?.trim() || "";

            // --------------------------------------------------
            // ### FIX
            // Si Native no proporciona host, utilizamos la IP
            // pública registrada para el equipo.
            // --------------------------------------------------

            const host =
                hostRecibido || device.public_ip || "";

            const port = Number(receiver.port);

            if (!Number.isInteger(sourceId) || sourceId < 1 || sourceId > 50) {

                return Response.json(
                    {
                        success: false,
                        error: `source_id inválido en el receptor ${index + 1}. Debe estar entre 1 y 50.`
                    },
                    {
                        status: 400,
                        headers: corsHeaders
                    }
                );

            }

            if (sourceIds.has(sourceId)) {

                return Response.json(
                    {
                        success: false,
                        error: `source_id duplicado: ${sourceId}.`
                    },
                    {
                        status: 400,
                        headers: corsHeaders
                    }
                );

            }

            sourceIds.add(sourceId);

            if (!nombre) {

                return Response.json(
                    {
                        success: false,
                        error: `Debe indicar un nombre para el receptor ${sourceId}.`
                    },
                    {
                        status: 400,
                        headers: corsHeaders
                    }
                );

            }

            if (mode !== "listener") {

                return Response.json(
                    {
                        success: false,
                        error: `Modo SRT no compatible para source_id ${sourceId}. Native requiere listener.`
                    },
                    {
                        status: 400,
                        headers: corsHeaders
                    }
                );

            }

            // ### FIX
            // RESERVED permite distinguir en LigronLink un receptor
            // retenido para reenganche de una Pi frente a uno libre,
            // ocupado o apagado.
            if (!["FREE", "BUSY", "RESERVED", "OFFLINE"].includes(estado)) {

                return Response.json(
                    {
                        success: false,
                        error: `Estado SRT inválido para source_id ${sourceId}.`
                    },
                    {
                        status: 400,
                        headers: corsHeaders
                    }
                );

            }

            if (!host) {

                return Response.json(
                    {
                        success: false,
                        error: `No se pudo determinar el host para source_id ${sourceId}.`
                    },
                    {
                        status: 400,
                        headers: corsHeaders
                    }
                );

            }

            if (!Number.isInteger(port) || port < 1 || port > 65535) {

                return Response.json(
                    {
                        success: false,
                        error: `Puerto inválido para source_id ${sourceId}.`
                    },
                    {
                        status: 400,
                        headers: corsHeaders
                    }
                );

            }

            normalizados.push({
                sourceId,
                nombre,
                host,
                port,
                mode,
                estado
            });

        }

        // --------------------------------------------------
        // ### FIX
        // Publicar receptores y refrescar presencia del equipo.
        // --------------------------------------------------

        const guardados =
            await replaceSrtDestinations(
                env.DB,
                {
                    uuid: device.uuid,
                    usuarioId: usuario.id
                },
                normalizados
            );

        await touchDevicePresence(
            env.DB,
            device.uuid,
            usuario.id
        );

        // --------------------------------------------------
        // OK
        // --------------------------------------------------

        return Response.json(
            {
                success: true,
                device_uuid: device.uuid,
                device_alias: device.alias,
                host_default: device.public_ip || null,
                receivers: guardados,
                count: guardados.length,
                linked_pis: await findLinkedPiStatuses(env.DB, usuario.id, device.uuid)
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
