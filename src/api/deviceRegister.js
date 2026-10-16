// ==========================================================
// LigronLink
// API - Registrar Equipo
// ==========================================================

// ### FIX
import { findUserByEmail } from "../database/users.js";
import { findDeviceByUuid, registerOrUpdateDevice } from "../database/devices.js";
import { requireUserSession } from "../security/sessions.js";
import { issueDeviceCredential } from "../security/deviceCredentials.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

function isLigronPi(device) {
    return ["ligronpi", "ligronpi native", "ligronpi_native"]
        .includes(String(device?.tipo || "").trim().toLowerCase());
}

// ==========================================================
// POST /api/v1/device/register
// ==========================================================

export async function deviceRegister(request, env) {

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

        const tipo = body.tipo?.trim();

        const alias = body.alias?.trim();

        const uuid = body.uuid?.trim() || "";

        const email = body.email?.trim().toLowerCase() || "";
        const recoverDeviceCredential = body.recover_device_credential === true;
        // ### FIX — IPv6 / DUAL STACK
        // Opcional: los clientes antiguos siguen registrándose sin este campo.
        const networkCapabilities = body.network_capabilities && typeof body.network_capabilities === "object"
            ? body.network_capabilities : null;

        // ==================================================
        // ### FIX
        // Cloudflare conoce la IP pública real desde la que
        // llega la conexión.
        // ==================================================

        const publicIp =
            request.headers.get("CF-Connecting-IP") || "";

        // --------------------------------------------------
        // Validaciones
        // --------------------------------------------------

        if (!tipo) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar el tipo de equipo."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

        if (!alias) {

            return Response.json(
                {
                    success: false,
                    error: "Debe indicar un alias."
                },
                {
                    status: 400,
                    headers: corsHeaders
                }
            );

        }

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
        // Usuario
        // --------------------------------------------------

        if (!email) {

            return Response.json(
                {
                    success: false,
                    error: "Debe iniciar sesión antes de registrar un equipo."
                },
                {
                    status: 401,
                    headers: corsHeaders
                }
            );

        }

        const usuario = await findUserByEmail(env.DB, email);

        if (!usuario) {

            return Response.json(
                {
                    success: false,
                    error: "No se pudo resolver la cuenta del equipo."
                },
                {
                    status: 401,
                    headers: corsHeaders
                }
            );

        }

        const usuarioId = usuario.id;
        const authenticatedUser = await requireUserSession(request, env.DB);
        if (authenticatedUser && Number(authenticatedUser.id) !== Number(usuarioId)) {
            return Response.json(
                { success: false, error: "La sesión no coincide con la cuenta del equipo." },
                { status: 403, headers: corsHeaders }
            );
        }
        const existente = await findDeviceByUuid(env.DB, uuid);

        // Un UUID ya conocido nunca cambia de cuenta por un registro. La
        // compartición multiempresa se hará más adelante mediante membresías
        // aprobadas, no reenviando email + UUID desde el cliente.
        if (existente && Number(existente.usuario_id) !== Number(usuarioId)) {
            return Response.json(
                {
                    success: false,
                    code: "DEVICE_ACCOUNT_MEMBERSHIP_REQUIRED",
                    error: "Este equipo pertenece a otra cuenta. Debe vincularse mediante una autorización aprobada."
                },
                {
                    status: 409,
                    headers: corsHeaders
                }
            );
        }

        // --------------------------------------------------
        // Registrar o actualizar equipo
        // --------------------------------------------------

        const esNative = true;

        const resultado = await registerOrUpdateDevice(
            env.DB,
            {
                usuarioId,
                tipo,
                alias,
                uuid,

                // ### FIX
                publicIp: esNative ? publicIp : null,

                // ### FIX
                ultimaConexion: esNative ? new Date().toISOString() : null,

                // ### FIX
                estado: esNative ? "ONLINE" : "OFFLINE"
            }
        );

        // Sólo se escribe al registrar o al cambiar red, nunca por polling.
        // La tabla es opcional durante el despliegue escalonado para no romper
        // instalaciones que aún no hayan aplicado la migración.
        if (networkCapabilities) {
            try {
                await env.DB.prepare(`INSERT INTO device_network_capabilities (device_uuid, capabilities_json, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(device_uuid) DO UPDATE SET capabilities_json=excluded.capabilities_json, updated_at=datetime('now') WHERE capabilities_json != excluded.capabilities_json`)
                    .bind(uuid, JSON.stringify(networkCapabilities)).run();
            } catch (capabilityError) {
                console.warn("IPv6 capabilities not persisted:", capabilityError.message);
            }
        }

        // --------------------------------------------------
        // OK
        // --------------------------------------------------

        // Sólo un registro respaldado por una sesión válida recibe el secreto
        // revocable de reconexión. Los clientes heredados siguen funcionando.
        // Una Pi ya conocida puede reparar su secreto local sin pedir una
        // contraseña en campo. La recuperación está acotada: UUID existente,
        // tipo LigronPi y misma cuenta ya asignada; nunca crea equipos nuevos
        // ni permite mover un equipo entre cuentas. Es necesaria cuando una
        // actualización o una tarjeta clonada conservó un token revocado.
        const canRecoverKnownPi = recoverDeviceCredential
            && existente
            && Number(existente.usuario_id) === Number(usuarioId)
            && isLigronPi(existente)
            && isLigronPi({ tipo });
        const deviceCredential = (authenticatedUser || canRecoverKnownPi)
            ? await issueDeviceCredential(env.DB, uuid)
            : "";

        return Response.json(

            {
                success: true,

                // ### FIX
                connected: esNative,

                // ### FIX
                publicIp: esNative ? publicIp : null,

                created: resultado.created,
                updated: resultado.updated,
                device_credential: deviceCredential || undefined

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
