// ==========================================================
// LigronLink
// Provisionamiento LigronTail para Native
// ==========================================================
//
// La aplicación nunca conoce el secreto OAuth de Tailscale. Tras un login
// válido, Link genera una única auth key etiquetada, de vida breve y de un
// solo uso; Native la entrega al instalador elevado de LigronTail.

import { hashPassword } from "../security/hash.js";
import { findUserByEmail } from "../database/users.js";
import { findDeviceByUuid } from "../database/devices.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

function response(payload, status = 200) {
    return Response.json(payload, { status, headers: corsHeaders });
}

function configuredValue(env, name) {
    return String(env[name] || "").trim();
}

async function tailscaleAccessToken(clientId, clientSecret) {
    const form = new URLSearchParams();
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
    const tokenResponse = await fetch("https://api.tailscale.com/api/v2/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
    });
    if (!tokenResponse.ok) {
        throw new Error("No se pudo obtener autorización de LigronTail.");
    }
    const token = await tokenResponse.json();
    if (!String(token.access_token || "").startsWith("tskey-")) {
        throw new Error("La autorización de LigronTail recibida no es válida.");
    }
    return token.access_token;
}

// POST /api/v1/ligrontail/bootstrap
export async function ligronTailBootstrap(request, env) {
    try {
        if (request.method !== "POST") {
            return response({ success: false, error: "Método no permitido." }, 405);
        }

        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        const deviceUuid = String(body.device_uuid || "").trim();
        if (!email || !password || !deviceUuid) {
            return response({ success: false, error: "Debe validar la cuenta y el equipo antes de activar LigronTail." }, 400);
        }

        // Esta operación crea una identidad de red. A diferencia del resto
        // del heartbeat, exige la contraseña recién introducida y no acepta
        // sólo email + UUID.
        const account = await findUserByEmail(env.DB, email);
        if (!account || await hashPassword(password) !== account.password_hash) {
            return response({ success: false, error: "No se pudo validar la cuenta para activar LigronTail." }, 401);
        }
        const device = await findDeviceByUuid(env.DB, deviceUuid);
        if (!device || Number(device.usuario_id) !== Number(account.id)) {
            return response({ success: false, error: "El equipo no pertenece a la cuenta autenticada." }, 403);
        }

        const clientId = configuredValue(env, "LIGRONTAIL_OAUTH_CLIENT_ID");
        const clientSecret = configuredValue(env, "LIGRONTAIL_OAUTH_CLIENT_SECRET");
        const tailnet = configuredValue(env, "LIGRONTAIL_TAILNET").toLowerCase();
        const tag = configuredValue(env, "LIGRONTAIL_DEVICE_TAG").toLowerCase();
        if (!clientId || !clientSecret || !tailnet || !tag.startsWith("tag:")) {
            return response({
                success: false,
                code: "LIGRONTAIL_NOT_CONFIGURED",
                error: "LigronTail todavía no está provisionado en el servidor."
            }, 503);
        }

        const accessToken = await tailscaleAccessToken(clientId, clientSecret);
        const keyResponse = await fetch(
            `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/keys`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    capabilities: {
                        devices: {
                            create: {
                                reusable: false,
                                ephemeral: false,
                                preauthorized: true,
                                tags: [tag]
                            }
                        }
                    },
                    expirySeconds: 600,
                    description: `LigronAir Native ${deviceUuid.slice(0, 12)}`
                })
            }
        );
        if (!keyResponse.ok) {
            throw new Error("LigronTail no pudo crear la identidad temporal del equipo.");
        }
        const key = await keyResponse.json();
        const authKey = String(key.key || "");
        if (!authKey.startsWith("tskey-auth-")) {
            throw new Error("LigronTail no devolvió una clave de equipo válida.");
        }

        // La auth key se devuelve una sola vez, no se registra ni se incluye
        // en logs. Su uso es único y expira en diez minutos.
        return response({
            success: true,
            tailnet,
            auth_key: authKey,
            expires_at: key.expires || null
        });
    }
    catch (error) {
        console.error("LigronTail bootstrap failed:", error?.message || error);
        return response({ success: false, error: "No se pudo preparar LigronTail para este equipo." }, 502);
    }
}
