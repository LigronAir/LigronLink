// ==========================================================
// LigronLink
// API - Asignación automática de receptor SRT
// ==========================================================

import { findDeviceByUuid } from "../database/devices.js";
import { allocateSrtDestination, releaseSrtDestination } from "../database/srtDestinations.js";
import { findUserByEmail } from "../database/users.js";
import { createRelaySession, relayConfiguration } from "./ligronRelay.js";
import { buildRoutePlan, buildSrtCallerUrl, publicRoutePlan } from "./routePlanner.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

// Link sólo decide el endpoint de un listener que Native ya publicó. No crea
// una segunda negociación al pulsar Play: eso era la carrera que dejaba a la
// Pi esperando y a Native sin una llamada concreta.
async function networkCapabilities(db, deviceUuid) {
    try {
        const row = await db.prepare(`SELECT capabilities_json FROM device_network_capabilities WHERE device_uuid=?1`)
            .bind(deviceUuid).first();
        return JSON.parse(row?.capabilities_json || "{}");
    } catch (error) {
        // La ruta pública sigue funcionando si la migración aún no existe.
        return {};
    }
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

        const relay = relayConfiguration(env);
        const [piNetwork, nativeNetwork] = await Promise.all([
            networkCapabilities(env.DB, pi.uuid),
            networkCapabilities(env.DB, device.uuid)
        ]);
        const routePlan = buildRoutePlan({
            pi,
            native: device,
            piNetwork,
            nativeNetwork,
            relay
        });
        const selectedRoute = routePlan.selected;

        // LigronRelay es la vía principal: Pi y Native realizan ambas una
        // llamada saliente autenticada al relay. Por ello funciona incluso
        // detrás de CGNAT y evita entregar tráfico UDP entrante a Native
        // cuando una VPN de escritorio lo filtra. LigronTail/LAN permanecen
        // como reserva automática si el relay aún no está desplegado.
        if (!selectedRoute) {
            return Response.json(
                {
                    success: false,
                    error: "No hay una ruta de media comprobada hacia Native.",
                    route_plan: publicRoutePlan(routePlan)
                },
                { status: 409, headers: corsHeaders }
            );
        }

        // Sólo después de validar la ruta reservamos el listener real.
        const assignment = await allocateSrtDestination(
            env.DB,
            usuario.id,
            piUuid,
            deviceUuid,
            sourceId
        );
        if (!assignment) {
            return Response.json(
                { success: false, error: "No hay receptores SRT libres en ese LigronAir." },
                { status: 409, headers: corsHeaders }
            );
        }

        if (!Number(assignment.port)) {
            await releaseSrtDestination(env.DB, usuario.id, piUuid, deviceUuid);
            return Response.json(
                { success: false, error: "LigronAir publicó una caja sin puerto SRT utilizable." },
                { status: 409, headers: corsHeaders }
            );
        }

        if (selectedRoute.id === "LIGRONRELAY_SRT") {
            try {
                const session = await createRelaySession(
                    env.DB,
                    relay,
                    usuario.id,
                    piUuid,
                    deviceUuid,
                    assignment.source_id,
                );
                return Response.json(
                    {
                        success: true,
                        assignment: {
                            device_uuid: assignment.equipo_uuid,
                            // Pi only receives the publisher credential. The
                            // reader credential is delivered separately to
                            // the authenticated Native heartbeat.
                            srt_url: session.publish_url,
                            route: "RELAY",
                            transport: "LIGRONRELAY_SRT",
                            relay_session_id: session.session_id,
                            source_id: assignment.source_id,
                            receiver_name: assignment.nombre,
                            port: relay.port,
                            native_port: assignment.port,
                            route_plan: publicRoutePlan(routePlan)
                        }
                    },
                    { headers: corsHeaders }
                );
            } catch (error) {
                await releaseSrtDestination(env.DB, usuario.id, piUuid, deviceUuid);
                throw new Error("LigronRelay no pudo crear una sesión segura: " + (error?.message || error));
            }
        }

        const host = selectedRoute.id === "TAILSCALE_DIRECT_CALLER"
            ? String(nativeNetwork.tailscale_ipv4_address || "").trim()
            : String(nativeNetwork.ipv4_address || "").trim();

        return Response.json(
            {
                success: true,
                assignment: {
                    device_uuid: assignment.equipo_uuid,
                    srt_url: buildSrtCallerUrl(host, assignment.port),
                    route: "DIRECT",
                    transport: selectedRoute.id,
                    source_id: assignment.source_id,
                    receiver_name: assignment.nombre,
                    port: assignment.port,
                    route_plan: publicRoutePlan(routePlan)
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
