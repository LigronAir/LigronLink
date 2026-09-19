// ==========================================================
// LigronLink
// API - Publicar receptores SRT
// ==========================================================

import { findUserByEmail } from "../database/users.js";
import {
    findDeviceByUuid,
    touchDevicePresence
} from "../database/devices.js";
import {
    hasSameSrtReceiverSnapshot,
    replaceSrtDestinations
} from "../database/srtDestinations.js";
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

            // Native es la única autoridad del endpoint audiovisual.
            // No combinar la IP observada de una petición HTTP (que puede
            // salir por VPN) con un puerto abierto en otra interfaz/router.
            const host = hostRecibido;

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

            if (!["listener", "rendezvous"].includes(mode)) {

                return Response.json(
                    {
                        success: false,
                    error: `Modo SRT no compatible para source_id ${sourceId}.`
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
                        error: `Native no publicó la dirección SRT exterior para source_id ${sourceId}.`
                    },
                    {
                        status: 400,
                        headers: corsHeaders
                    }
                );

            }

            const ipv4Parts = host.split(".");
            const validIpv4 =
                ipv4Parts.length === 4 &&
                ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
            const validIpv6 = host.includes(":") && /^[0-9a-f:]+$/i.test(host);

            if (!validIpv4 && !validIpv6) {
                return Response.json(
                    {
                        success: false,
                        error: `Dirección SRT exterior inválida para source_id ${sourceId}.`
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

        const snapshotDevice = {
            uuid: device.uuid,
            usuarioId: usuario.id
        };

        const unchanged = await hasSameSrtReceiverSnapshot(
            env.DB,
            snapshotDevice,
            normalizados
        );

        const guardados = unchanged
            ? normalizados.map((receiver) => ({
                source_id: receiver.sourceId,
                name: receiver.nombre,
                host: receiver.host,
                port: receiver.port,
                mode: receiver.mode,
                state: receiver.estado
            }))
            : await replaceSrtDestinations(env.DB, snapshotDevice, normalizados);

        await touchDevicePresence(
            env.DB,
            device.uuid,
            usuario.id
        );

        // A reservation is a live control-plane lease, not historical UI
        // data.  When its Pi has stopped heartbeating, free the box on the
        // next Native snapshot so it cannot remain a phantom reservation.
        await env.DB.prepare(`
            UPDATE srt_destinos
            SET estado='FREE', reservado_por_uuid=NULL,
                ultima_actualizacion=datetime('now')
            WHERE equipo_uuid=?1 AND usuario_id=?2 AND estado='RESERVED'
              AND NOT EXISTS (
                  SELECT 1 FROM equipos AS pi
                  WHERE pi.uuid=srt_destinos.reservado_por_uuid
                    AND pi.usuario_id=srt_destinos.usuario_id
                    AND UPPER(pi.estado)='ONLINE'
                    AND datetime(pi.ultima_conexion)>=datetime('now','-45 seconds')
              )
        `).bind(device.uuid, usuario.id).run();

        // --------------------------------------------------
        // OK
        // --------------------------------------------------

        return Response.json(
            {
                success: true,
                device_uuid: device.uuid,
                device_alias: device.alias,
                host_default: normalizados[0]?.host || null,
                receivers: guardados,
                count: guardados.length,
                snapshot_changed: !unchanged,
                linked_pis: await findLinkedPiStatuses(env.DB, usuario.id, device.uuid),
                // Native receives this response reliably on every snapshot.
                // Carry the control-plane request in the same authenticated
                // response instead of making Pi wait for a second poll path.
                connection_requests: (await env.DB.prepare(`
                    SELECT request.request_id, request.source_id, request.host, request.port, request.state
                    FROM connection_requests AS request
                    JOIN equipos AS pi
                      ON pi.uuid=request.pi_device_uuid
                     AND pi.usuario_id=request.usuario_id
                    WHERE request.usuario_id=?1 AND request.native_device_uuid=?2
                      AND datetime(request.expires_at)>datetime('now')
                      AND UPPER(pi.estado)='ONLINE'
                      AND datetime(pi.ultima_conexion)>=datetime('now','-45 seconds')
                      AND request.state IN ('PENDING','PI_READY','BOX_READY','CALLER_REQUIRED')
                    ORDER BY request.created_at ASC
                `).bind(usuario.id, device.uuid).all()).results || []
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
