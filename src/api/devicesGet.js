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
            devicesRaw.map((device) => ({
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
                runtime_status:
                    runtimeByDevice.get(device.uuid) || null
            }));

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
