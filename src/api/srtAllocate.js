// ==========================================================
// LigronLink
// API - Asignación automática de receptor SRT
// ==========================================================

import { findDeviceByUuid } from "../database/devices.js";
import { allocateSrtDestination } from "../database/srtDestinations.js";
import { findUserByEmail } from "../database/users.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// ==========================================================
// ### FIX
// Construir URL SRT para Pi caller.
// ==========================================================

function buildSrtUrl(host, port) {

    const normalizedHost =
        String(host).includes(":") && !String(host).startsWith("[")
            ? `[${host}]`
            : host;

    return `srt://${normalizedHost}:${port}?mode=caller`;

}

// ### FIX — SRT RENDEZVOUS
async function createRendezvousSession(db, usuarioId, pi, native, assignment) {
    const sessionId = `rv_${crypto.randomUUID()}`;
    const sessionPort = 13000 + Number(assignment.source_id) - 1;
    await db.prepare(`INSERT INTO rendezvous_sessions (session_id, usuario_id, source_device_uuid, destination_device_uuid, box_id, session_port, route, pi_public_ip, native_public_ip, state, expires_at) VALUES (?1,?2,?3,?4,?5,?6,'RENDEZVOUS',?7,?8,'CREATED',datetime('now','+45 seconds'))`)
        .bind(sessionId, usuarioId, pi.uuid, native.uuid, assignment.source_id, sessionPort, pi.public_ip || null, native.public_ip || null).run();
    return { session_id: sessionId, session_port: sessionPort, route: "RENDEZVOUS", peer_host: native.public_ip || assignment.host };
}

// ==========================================================
// POST /api/v1/srt/allocate
// ==========================================================

export async function srtAllocate(request, env) {

    try {

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

        const body = await request.json();

        const email =
            body.email?.trim().toLowerCase() || "";

        const piUuid =
            body.pi_uuid?.trim() || "";

        const deviceUuid =
            body.device_uuid?.trim() || "";

        const sourceId =
            body.source_id === undefined || body.source_id === null
                ? null
                : Number(body.source_id);

        if (!email || !piUuid || !deviceUuid) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar email, pi_uuid y device_uuid."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        if (sourceId !== null && (!Number.isInteger(sourceId) || sourceId < 1 || sourceId > 50)) {
            return Response.json(
                { success: false, error: "source_id inválido." },
                { status: 400, headers: corsHeaders }
            );
        }

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

        // ### FIX
        // La Pi debe existir y pertenecer al mismo usuario.
        const pi =
            await findDeviceByUuid(
                env.DB,
                piUuid
            );

        if (
            !pi ||
            Number(pi.usuario_id) !== Number(usuario.id) ||
            !["ligronpi", "ligronpi native", "ligronpi_native"].includes(
                String(pi.tipo || "").trim().toLowerCase()
            )
        ) {

            return Response.json(
                {
                    success: false,
                    error: "LigronPi no autorizado para este usuario."
                },
                {
                    status: 403,
                    headers: corsHeaders
                }
            );

        }

        // ### FIX
        // El receptor Native debe existir, estar ONLINE y pertenecer al usuario.
        const device =
            await findDeviceByUuid(
                env.DB,
                deviceUuid
            );

        if (
            !device ||
            Number(device.usuario_id) !== Number(usuario.id) ||
            !["ligronair", "ligronair native", "ligronair_native"].includes(
                String(device.tipo || "").trim().toLowerCase()
            )
        ) {

            return Response.json(
                {
                    success: false,
                    error: "LigronAir no autorizado para este usuario."
                },
                {
                    status: 403,
                    headers: corsHeaders
                }
            );

        }

        if (String(device.estado || "").trim().toUpperCase() !== "ONLINE") {

            return Response.json(
                {
                    success: false,
                    error: "LigronAir no está ONLINE."
                },
                {
                    status: 409,
                    headers: corsHeaders
                }
            );

        }

        // Rendezvous necesita dos extremos de red distintos. Cuando Link
        // observa la misma IPv4 pública para Pi y Native, la ruta actual
        // estaría mandando a ambos a esa misma dirección y al mismo puerto:
        // no es NAT traversal, es una tentativa de hairpin/autoconexión.
        // No reservamos una caja para una sesión que no puede ser válida.
        const nativeRendezvous = String(device.public_ip || "").trim();
        const piRendezvous = String(pi.public_ip || "").trim();
        if (nativeRendezvous && piRendezvous && nativeRendezvous === piRendezvous) {
            return Response.json(
                {
                    success: false,
                    error: "Rendezvous no disponible: Pi y Native comparten la misma IP pública observada. Use la dirección LAN directa si están en la misma red, o una ruta pública/IPv6 distinta."
                },
                {
                    status: 409,
                    headers: corsHeaders
                }
            );
        }

        // ### FIX
        // Asignación atómica: un único UPDATE selecciona y reserva.
        const assignment =
            await allocateSrtDestination(
                env.DB,
                usuario.id,
                piUuid,
                deviceUuid,
                sourceId
            );

        if (!assignment) {

            return Response.json(
                {
                    success: false,
                    error: "No hay receptores SRT libres en ese LigronAir."
                },
                {
                    status: 409,
                    headers: corsHeaders
                }
            );

        }

        const rendezvous = String(assignment.mode || "listener").toLowerCase() === "rendezvous"
            ? await createRendezvousSession(env.DB, usuario.id, pi, device, assignment)
            : null;

        return Response.json(
            {
                success: true,
                assignment: {
                    device_uuid: assignment.equipo_uuid,
                    srt_url: rendezvous ? "" : buildSrtUrl(
                        assignment.host,
                        assignment.port
                    ),
                    route: rendezvous ? "RENDEZVOUS" : "DIRECT",
                    rendezvous,

                    // ### FIX
                    // Campos técnicos para diagnóstico/log; no deben
                    // utilizarse como selección de operador.
                    source_id: assignment.source_id,
                    receiver_name: assignment.nombre,
                    port: assignment.port
                }
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
