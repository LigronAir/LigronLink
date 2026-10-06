// ==========================================================
// LigronLink
// API - Obtener equipos del usuario
// ==========================================================

import {
    findDevicesByUser,
    findRuntimeStatusByUser
} from "../database/devices.js";

// ### FIX
import { requireUserSession } from "../security/sessions.js";
import { buildRoutePlan, publicRoutePlan } from "./routePlanner.js";
import { relayConfiguration } from "./ligronRelay.js";

// ### FIX
import {
    findSrtReceiverSummaryByUser,
    findSrtReceiversByUser
} from "../database/srtDestinations.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

// La presencia tiene una ventana corta: los valores de runtime y las cajas
// son fotografías persistidas, pero sólo son operativos si el equipo sigue
// comunicándose con Link.
const PRESENCE_WINDOW_MS = 75 * 1000;

function parseD1Timestamp(value) {
    if (!value) return Number.NaN;
    const text = String(value).trim();
    const normalized = text.includes("T")
        ? text
        : text.replace(" ", "T");
    return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(normalized)
        ? normalized
        : normalized + "Z");
}

function isDevicePresent(device, now = Date.now()) {
    if (String(device?.estado || "").toUpperCase() !== "ONLINE") {
        return false;
    }
    const lastSeen = parseD1Timestamp(device?.ultima_conexion);
    return Number.isFinite(lastSeen) && now - lastSeen >= 0 &&
        now - lastSeen <= PRESENCE_WINDOW_MS;
}

function summarizeReceivers(receivers, fallback) {
    if (!Array.isArray(receivers) || receivers.length === 0) {
        return fallback;
    }
    const totals = {
        total: receivers.length,
        free: 0,
        busy: 0,
        reserved: 0,
        offline: 0,
        last_update: fallback?.last_update || null
    };
    for (const receiver of receivers) {
        const state = String(receiver.state || "OFFLINE").toUpperCase();
        if (state === "FREE") totals.free += 1;
        else if (state === "BUSY") totals.busy += 1;
        else if (state === "RESERVED") totals.reserved += 1;
        else totals.offline += 1;
    }
    return totals;
}

// ==========================================================
// GET /api/v1/devices
// ==========================================================

export async function devicesGet(request, env) {

    try {

        const usuario = await requireUserSession(request, env.DB);

        if (!usuario) {

            return Response.json(
                {
                    success: false,
                    error: "Sesión no válida o caducada. Inicie sesión de nuevo."
                },
                {
                    status: 401,
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
                reserved_by_alias: receiver.reserved_by_alias || "",
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
                        telemetry: (() => {
                            try { return JSON.parse(row.telemetry_json || "{}"); } catch { return {}; }
                        })(),
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
                ipv6_global: capabilities.ipv6_global === true,
                ipv6_internet: capabilities.ipv6_internet === true,
                srt_ipv6: capabilities.srt_ipv6 === true,
                tailscale_available: capabilities.tailscale_available === true,
                tailscale_ipv4_address: String(capabilities.tailscale_ipv4_address || ""),
                tailscale_tailnet: String(capabilities.tailscale_tailnet || ""),
                tailscale_state: String(capabilities.tailscale_state || "UNKNOWN").toUpperCase(),
                hardware_model: String(capabilities.hardware_model || ""),
                hardware_memory_gb: Number(capabilities.hardware_memory_gb || 0),
                device_role: String(capabilities.device_role || "").toUpperCase(),
                tailscale_provisioning_state: String(capabilities.tailscale_provisioning_state || "").toUpperCase(),
                tailscale_provisioning_error: String(capabilities.tailscale_provisioning_error || ""),
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

        const presenceNow = Date.now();
        const devices =
            devicesRaw.map((device) => {
                const present = isDevicePresent(device, presenceNow);
                const nativeDevice = String(device.tipo || "")
                    .trim()
                    .toLowerCase()
                    .includes("ligronair");
                const rawReceivers = receiversByDevice.get(device.uuid) || [];
                // Una reserva persistida permite recuperar un reinicio breve,
                // pero con Native sin presencia no es una caja reservada ni
                // disponible desde el punto de vista operativo.
                const receivers = nativeDevice && !present
                    ? rawReceivers.map((receiver) => ({
                        ...receiver,
                        reported_state: receiver.state,
                        inactive_reservation_by_alias:
                            receiver.reserved_by_alias || "",
                        state: "OFFLINE"
                    }))
                    : rawReceivers;
                const rawSummary = srtByDevice.get(device.uuid) || {
                    total: 0,
                    free: 0,
                    busy: 0,
                    reserved: 0,
                    offline: 0,
                    last_update: null
                };
                const publishedNetwork = networkByDevice.get(device.uuid);
                const networkStatus = publishedNetwork
                    ? {
                        ...publishedNetwork,
                        last_seen_at: device.ultima_conexion || null,
                        sync_state: present
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
                reported_state: String(device.estado || "OFFLINE").toUpperCase(),
                estado: present ? "ONLINE" : "OFFLINE",
                control_state: present ? "ONLINE" : "OFFLINE",
                srt_receivers:
                    summarizeReceivers(receivers, rawSummary),
                srt_receiver_list:
                    receivers,
                network_status: networkStatus,
                runtime_status:
                    runtimeByDevice.get(device.uuid) || null
                });
            });

        // La misma política que usa /srt/allocate se publica al panel. No
        // contiene secretos ni URLs de media: sólo capacidades verificables.
        const piDevices = devices.filter((device) => String(device.tipo || "").toLowerCase().includes("ligronpi"));
        const nativeDevices = devices.filter((device) => String(device.tipo || "").toLowerCase().includes("ligronair"));
        const routePlans = [];
        const relay = relayConfiguration(env);
        for (const pi of piDevices) {
            for (const native of nativeDevices) {
                routePlans.push({
                    pi_uuid: pi.uuid,
                    native_uuid: native.uuid,
                    ...publicRoutePlan(buildRoutePlan({
                        pi,
                        native,
                        piNetwork: pi.network_status || {},
                        nativeNetwork: native.network_status || {},
                        relay
                    }))
                });
            }
        }

        // --------------------------------------------------
        // Respuesta
        // --------------------------------------------------

        return Response.json(

            {

                success: true,

                devices,
                route_plans: routePlans

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
