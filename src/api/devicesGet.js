// ==========================================================
// LigronLink
// API - Obtener equipos del usuario
// ==========================================================

import {
    findDevicesByUser,
    findRuntimeStatusByUser
} from "../database/devices.js";

// ### FIX
import { findUserByEmail } from "../database/users.js";

// ### FIX
import {
    findSrtReceiverSummaryByUser,
    findSrtReceiversByUser
} from "../database/srtDestinations.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

function isMissingRuntimeStatusTable(error) {

    return String(error?.message || error)
        .toLowerCase()
        .includes("no such table: device_runtime_status");

}

function isMissingNetworkCapabilitiesTable(error) {
    return String(error?.message || error)
        .toLowerCase()
        .includes("no such table: device_network_capabilities");
}

// ==========================================================
// GET /api/v1/devices
// ==========================================================

export async function devicesGet(request, env) {

    try {

        // --------------------------------------------------
        // ### FIX
        // Obtener email desde la URL
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
        // ### FIX
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
        // Obtener equipos
        // --------------------------------------------------

        const devicesRaw =
            await findDevicesByUser(
                env.DB,
                usuario.id
            );

        // ### FIX
        // Añadir estado agregado de receptores SRT para que la web
        // pueda visualizar disponibilidad real de Native sin pedir
        // al operador que entre en LigronPi.
        const srtRows =
            await findSrtReceiverSummaryByUser(
                env.DB,
                usuario.id
            );

        // ### FIX
        // Detalle de cajas/puertos para desplegable en la web.
        const receiverRows =
            await findSrtReceiversByUser(
                env.DB,
                usuario.id
            );

        const receiversByDevice =
            new Map();

        for (const receiver of receiverRows) {

            const key =
                receiver.equipo_uuid;

            if (!receiversByDevice.has(key)) {

                receiversByDevice.set(key, []);

            }

            receiversByDevice.get(key).push({
                id: receiver.id,
                source_id: receiver.source_id,
                name: receiver.nombre,
                host: receiver.host,
                port: receiver.port,
                mode: receiver.mode,
                state: receiver.estado,
                reserved_by: receiver.reservado_por_uuid,
                last_update: receiver.ultima_actualizacion
            });

        }

        // ### FIX
        // Estado operativo publicado por Pi/Native.
        let runtimeRows = [];

        try {

            runtimeRows =
                await findRuntimeStatusByUser(
                    env.DB,
                    usuario.id
                );

        }
        catch (error) {

            if (!isMissingRuntimeStatusTable(error)) {
                throw error;
            }

            // La ausencia de esta tabla no debe impedir que Link muestre
            // equipos, receptores y reservas ya existentes.
            console.warn(
                "device_runtime_status aún no existe; se omite runtime_status."
            );

        }

        const runtimeByDevice =
            new Map(
                runtimeRows.map((row) => [
                    row.device_uuid,
                    {
                        runtime_state: row.runtime_state,
                        source_label: row.source_label,
                        target_device_uuid: row.target_device_uuid,
                        target_label: row.target_label,
                        target_srt_url: row.target_srt_url,
                        streaming: Boolean(row.streaming),
                        pipeline_active: Boolean(row.pipeline_active),
                        signal_available: Boolean(row.signal_available),
                        audio_state: row.audio_state,
                        last_update: row.ultima_actualizacion
                    }
                ])
            );

        // Red realmente publicada por cada equipo. Se expone sólo a equipos
        // de la misma cuenta y permite verificar qué endpoint puede escoger
        // Link antes de intentar una emisión.
        let capabilityRows = [];
        try {
            capabilityRows = (await env.DB.prepare(`SELECT c.device_uuid, c.capabilities_json, c.updated_at FROM device_network_capabilities c INNER JOIN equipos e ON e.uuid=c.device_uuid WHERE e.usuario_id=?1`)
                .bind(usuario.id).all()).results || [];
        } catch (error) {
            if (!isMissingNetworkCapabilitiesTable(error)) throw error;
        }
        const networkByDevice = new Map(capabilityRows.map((row) => {
            let capabilities = {};
            try { capabilities = JSON.parse(row.capabilities_json || "{}"); } catch { capabilities = {}; }
            return [row.device_uuid, {
                ipv4_address: String(capabilities.ipv4_address || ""),
                ipv6_address: String(capabilities.ipv6_address || ""),
                tailscale_available: capabilities.tailscale_available === true,
                tailscale_ipv4_address: String(capabilities.tailscale_ipv4_address || ""),
                tailscale_tailnet: String(capabilities.tailscale_tailnet || ""),
                tailscale_state: String(capabilities.tailscale_state || "UNKNOWN").toUpperCase(),
                updated_at: row.updated_at || null
            }];
        }));

        const srtByDevice =
            new Map(
                srtRows.map((row) => [
                    row.equipo_uuid,
                    {
                        total: Number(row.total || 0),
                        free: Number(row.free || 0),
                        busy: Number(row.busy || 0),
                        reserved: Number(row.reserved || 0),
                        offline: Number(row.offline || 0),
                        last_update: row.last_update || null
                    }
                ])
            );

        const devices =
            devicesRaw.map((device) => {
                const publishedNetwork = networkByDevice.get(device.uuid);
                const networkStatus = publishedNetwork
                    ? {
                        ...publishedNetwork,
                        last_seen_at: device.ultima_conexion || null,
                        sync_state: String(device.estado).toUpperCase() === "ONLINE"
                            ? "SYNCED" : "STALE"
                    }
                    : {
                        tailscale_available: false,
                        tailscale_state: "NO_REPORT",
                        last_seen_at: device.ultima_conexion || null,
                        sync_state: "NO_REPORT"
                    };
                return ({
                ...device,
                srt_receivers:
                    srtByDevice.get(device.uuid) || {
                        total: 0,
                        free: 0,
                        busy: 0,
                        reserved: 0,
                        offline: 0,
                        last_update: null
                    },
                srt_receiver_list:
                    receiversByDevice.get(device.uuid) || [],
                network_status: networkStatus,
                runtime_status:
                    runtimeByDevice.get(device.uuid) || null
                });
            });

        // --------------------------------------------------
        // Respuesta
        // --------------------------------------------------

        return Response.json(

            {

                success: true,

                devices

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
