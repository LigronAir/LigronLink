// ==========================================================
// LigronLink
// Provisionamiento LigronTail para Native
// ==========================================================
//
// La aplicación nunca conoce el secreto OAuth de Tailscale. Tras un login
// válido, Link genera una única auth key etiquetada, de vida breve y de un
// solo uso; Native la entrega al instalador elevado de LigronTail.

import { hashPassword, verifyPassword } from "../security/hash.js";
import { findUserByEmail, updateUserPasswordHash } from "../database/users.js";
import { findDeviceByUuid } from "../database/devices.js";
import { requireDeviceCredential } from "../security/deviceCredentials.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

function piHostname(deviceUuid) {
    return `ligronpi-${String(deviceUuid || "").replaceAll("-", "").slice(0, 8).toLowerCase()}`;
}

// Revocar la credencial de Link debe sacar también a la Pi de la red privada,
// no limitarse a impedir la próxima petición de auth-key. El OAuth de
// LigronTail necesita el permiso `devices:core` además del de crear keys;
// cuando un despliegue todavía no lo tiene, devolvemos el estado explícito
// para que el panel no afirme falsamente que retiró el nodo.
export async function revokeLigronTailDevice(env, deviceUuid) {
    const clientId = configuredValue(env, "LIGRONTAIL_OAUTH_CLIENT_ID");
    const clientSecret = configuredValue(env, "LIGRONTAIL_OAUTH_CLIENT_SECRET");
    const tailnet = configuredValue(env, "LIGRONTAIL_TAILNET").toLowerCase();
    const tag = configuredValue(env, "LIGRONTAIL_DEVICE_TAG").toLowerCase();
    if (!clientId || !clientSecret || !tailnet || !tag.startsWith("tag:")) {
        return { state: "NOT_CONFIGURED", removed: false };
    }
    try {
        const accessToken = await tailscaleAccessToken(clientId, clientSecret);
        const listing = await fetch(
            `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/devices`,
            { headers: { "Authorization": `Bearer ${accessToken}` } }
        );
        if (!listing.ok) {
            return { state: "LIST_DENIED", removed: false };
        }
        const payload = await listing.json();
        const hostname = piHostname(deviceUuid);
        const matchingNodes = (Array.isArray(payload?.devices) ? payload.devices : [])
            .filter((node) => {
                const nodeHostname = String(node?.hostname || "").toLowerCase();
                const nodeTags = Array.isArray(node?.tags) ? node.tags.map((item) => String(item).toLowerCase()) : [];
                return nodeHostname === hostname && (nodeTags.length === 0 || nodeTags.includes(tag));
            });
        if (!matchingNodes.length) {
            return { state: "NOT_FOUND", removed: false };
        }
        let removed = 0;
        for (const node of matchingNodes) {
            const nodeId = String(node?.id || "").trim();
            if (!nodeId) continue;
            const deletion = await fetch(
                `https://api.tailscale.com/api/v2/device/${encodeURIComponent(nodeId)}`,
                {
                    method: "DELETE",
                    headers: { "Authorization": `Bearer ${accessToken}` }
                }
            );
            if (deletion.ok || deletion.status === 404) removed += 1;
        }
        return {
            state: removed === matchingNodes.length ? "REMOVED" : "DELETE_DENIED",
            removed: removed === matchingNodes.length,
            nodes: matchingNodes.length
        };
    } catch (error) {
        console.error("LigronTail revoke failed:", error?.message || error);
        return { state: "PROVIDER_UNAVAILABLE", removed: false };
    }
}

// POST /api/v1/ligrontail/bootstrap
export async function ligronTailBootstrap(request, env) {
    try {
        if (request.method !== "POST") {
            return response({ success: false, error: "Método no permitido." }, 405);
        }

        const body = await request.json();
        const deviceUuid = String(body.device_uuid || "").trim();
        const usesDeviceCredential = /^Device\s+/i.test(String(request.headers.get("Authorization") || ""));
        let device = null;

        if (usesDeviceCredential) {
            // LigronPi no conserva contraseñas de clientes. Su credencial
            // cifrada de equipo sólo puede pedir una clave efímera para su
            // propio UUID, nunca para otro dispositivo de la cuenta.
            if (!deviceUuid || !await requireDeviceCredential(request, env.DB, deviceUuid, { touch: true })) {
                return response({ success: false, code: "DEVICE_AUTH_FAILED", error: "La credencial de esta Pi no es válida." }, 401);
            }
            device = await findDeviceByUuid(env.DB, deviceUuid);
            if (!device) {
                return response({ success: false, code: "DEVICE_OWNERSHIP_FAILED", error: "El equipo no está registrado." }, 403);
            }
            if (!String(device.tipo || "").toLowerCase().includes("ligronpi")) {
                return response({ success: false, code: "DEVICE_TYPE_NOT_ALLOWED", error: "Sólo una Pi puede usar el alta autónoma de LigronTail." }, 403);
            }
        } else {
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");
            if (!email || !password || !deviceUuid) {
                return response({
                    success: false,
                    code: "BOOTSTRAP_INPUT_MISSING",
                    error: "Debe validar la cuenta y el equipo antes de activar LigronTail."
                }, 400);
            }

            // El alta manual de Native exige la contraseña recién introducida.
            const account = await findUserByEmail(env.DB, email);
            const verification = account
                ? await verifyPassword(password, account.password_hash)
                : { valid: false, needsRehash: false };
            if (!verification.valid) {
                return response({
                    success: false,
                    code: "ACCOUNT_VALIDATION_FAILED",
                    error: "No se pudo validar la cuenta para activar LigronTail."
                }, 401);
            }
            if (verification.needsRehash) {
                await updateUserPasswordHash(env.DB, account.id, await hashPassword(password));
            }
            device = await findDeviceByUuid(env.DB, deviceUuid);
            if (!device || Number(device.usuario_id) !== Number(account.id)) {
                return response({
                    success: false,
                    code: "DEVICE_OWNERSHIP_FAILED",
                    error: "El equipo no pertenece a la cuenta autenticada."
                }, 403);
            }
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
                    description: `LigronAir ${String(device.tipo || "device")} ${deviceUuid.slice(0, 12)}`
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
        return response({
            success: false,
            code: "LIGRONTAIL_PROVIDER_FAILED",
            error: "No se pudo preparar LigronTail para este equipo."
        }, 502);
    }
}
