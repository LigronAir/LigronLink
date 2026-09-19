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
async function createRendezvousSession(db, usuarioId, pi, native, assignment, piEndpoint, nativeEndpoint, addressFamily, route = "RENDEZVOUS") {
    const sessionId = `rv_${crypto.randomUUID()}`;
    const sessionPort = 13000 + Number(assignment.source_id) - 1;
    await db.prepare(`INSERT INTO rendezvous_sessions (session_id, usuario_id, source_device_uuid, destination_device_uuid, box_id, session_port, route, pi_public_ip, native_public_ip, state, expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'CREATED',datetime('now','+45 seconds'))`)
        .bind(sessionId, usuarioId, pi.uuid, native.uuid, assignment.source_id, sessionPort, route, piEndpoint || null, nativeEndpoint || null).run();
    return { session_id: sessionId, session_port: sessionPort, route, address_family: addressFamily, peer_host: nativeEndpoint || assignment.host };
}

// ### FIX — IPv6 RENDEZVOUS
// Las capacidades son datos declarados por el cliente, no sustituyen la
// validación SRT. Sólo se usan cuando ambos extremos han confirmado ruta IPv6.
async function usableIpv6Endpoint(db, deviceUuid) {
    try {
        const row = await db.prepare(`SELECT capabilities_json FROM device_network_capabilities WHERE device_uuid=?1`)
            .bind(deviceUuid).first();
        const capabilities = JSON.parse(row?.capabilities_json || "{}");
        const address = String(capabilities.ipv6_address || "").trim();
        const hasRoute = capabilities.srt_ipv6 === true && capabilities.ipv6_internet === true;
        const invalid = /^(::1|fe80:|fc|fd)/i.test(address);
        return hasRoute && /^[0-9a-f:]+$/i.test(address) && address.includes(":") && !invalid
            ? address : "";
    } catch (error) {
        // La migración de capabilities puede no estar aplicada todavía.
        console.warn("IPv6 capabilities unavailable:", error.message);
        return "";
    }
}

function samePrivateLan(piAddress, nativeAddress) {
    const parse = (value) => String(value).split(".").map(Number);
    const pi = parse(piAddress);
    const native = parse(nativeAddress);
    const valid = (parts) => parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    const privateV4 = (parts) => parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
    return valid(pi) && valid(native) && privateV4(pi) && privateV4(native) && pi.slice(0, 3).join(".") === native.slice(0, 3).join(".");
}

async function lanIpv4Endpoint(db, deviceUuid) {
    try {
        const row = await db.prepare(`SELECT capabilities_json FROM device_network_capabilities WHERE device_uuid=?1`).bind(deviceUuid).first();
        const capabilities = JSON.parse(row?.capabilities_json || "{}");
        return capabilities.srt_ipv4 === true ? String(capabilities.ipv4_address || "").trim() : "";
    } catch (error) {
        return "";
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

        // ### FIX — IPv6 RENDEZVOUS
        // IPv6 global se intenta primero: no depende del NAT IPv4 compartido.
        // Si falta en cualquiera de los dos extremos, se conserva el flujo IPv4.
        const [piIpv6, nativeIpv6, piLanIpv4, nativeLanIpv4] = await Promise.all([
            usableIpv6Endpoint(env.DB, pi.uuid),
            usableIpv6Endpoint(env.DB, device.uuid),
            lanIpv4Endpoint(env.DB, pi.uuid),
            lanIpv4Endpoint(env.DB, device.uuid)
        ]);
        const useIpv6 = Boolean(piIpv6 && nativeIpv6);
        const sharedIpv4 = String(pi.public_ip || "").trim() && String(pi.public_ip || "").trim() === String(device.public_ip || "").trim();
        const useLanDirect = !useIpv6 && sharedIpv4 && samePrivateLan(piLanIpv4, nativeLanIpv4);
        const piEndpoint = useIpv6 ? piIpv6 : useLanDirect ? piLanIpv4 : String(pi.public_ip || "").trim();
        const nativeEndpoint = useIpv6 ? nativeIpv6 : useLanDirect ? nativeLanIpv4 : String(device.public_ip || "").trim();

        // Rendezvous IPv4 necesita dos extremos de red distintos. Cuando Link
        // observa la misma IPv4 pública para Pi y Native, la ruta actual
        // estaría mandando a ambos a esa misma dirección y al mismo puerto:
        // no es NAT traversal, es una tentativa de hairpin/autoconexión.
        // No reservamos una caja para una sesión que no puede ser válida.
        if (!useIpv6 && !useLanDirect && nativeEndpoint && piEndpoint && nativeEndpoint === piEndpoint) {
            const lanDiagnostic = `Pi LAN=${piLanIpv4 || "NO REGISTRADA"}; Native LAN=${nativeLanIpv4 || "NO REGISTRADA"}; mismo segmento /24=${samePrivateLan(piLanIpv4, nativeLanIpv4) ? "SI" : "NO"}.`;
            return Response.json(
                {
                    success: false,
                    // ### FIX — LAN DIRECT DIAGNOSTIC
                    error: `Rendezvous no disponible: Pi y Native comparten la misma IP pública observada y no hay IPv6 global verificable en ambos extremos. ${lanDiagnostic}`
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

        const rendezvousRoute = useLanDirect ? "LAN_DIRECT" : "RENDEZVOUS";
        // ### FIX — LAN DIRECT COORDINATION
        // Los receptores normales de Native son listeners. LAN_DIRECT invierte
        // esa relación de forma temporal y, por tanto, siempre necesita sesión
        // Link aunque el receptor reservado tenga modo listener.
        const needsCoordinatedSession = useLanDirect
            || String(assignment.mode || "listener").toLowerCase() === "rendezvous";
        const rendezvous = needsCoordinatedSession
            ? await createRendezvousSession(env.DB, usuario.id, pi, device, assignment, piEndpoint, nativeEndpoint, useIpv6 ? "IPv6" : "IPv4", rendezvousRoute)
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
                    route: rendezvous ? rendezvousRoute : "DIRECT",
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
