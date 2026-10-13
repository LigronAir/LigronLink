import { findDeviceByUuid } from "../database/devices.js";
import { requireDeviceCredential } from "../security/deviceCredentials.js";
import { requireUserSession } from "../security/sessions.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const SHA256 = /^[a-f0-9]{64}$/i;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHANNEL = /^[a-z][a-z0-9_-]{0,31}$/;

function response(payload, status = 200) {
    return Response.json(payload, { status, headers: corsHeaders });
}

function isPi(device) {
    return ["ligronpi", "ligronpi v2", "ligron_pi"]
        .includes(String(device?.tipo || "").trim().toLowerCase());
}

function developmentSourceUrl(value) {
    let url;
    try {
        url = new URL(String(value || ""));
    } catch {
        return null;
    }
    // Durante desarrollo el paquete viaja cifrado por LigronTail. No se
    // admiten destinos LAN/públicos ni URLs con usuario, contraseña o query.
    const pieces = url.hostname.split(".");
    const octets = pieces.map((part) => Number(part));
    const first = octets[0];
    const second = octets[1];
    const tailnetIpv4 = pieces.length === 4
        && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
        && first === 100 && second >= 64 && second <= 127;
    if (url.protocol !== "http:" || !tailnetIpv4 || url.username || url.password || url.search) {
        return null;
    }
    const port = Number(url.port || "80");
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
    if (!/^\/[A-Za-z0-9._/-]{16,240}$/.test(url.pathname) || url.pathname.includes("..")) return null;
    return url.toString();
}

async function authenticatedPi(env, request, uuidValue) {
    const uuid = String(uuidValue || "").trim();
    if (!uuid) return { error: "Debe indicar el UUID de LigronPi.", status: 400 };
    const credential = await requireDeviceCredential(request, env.DB, uuid);
    if (!credential) return { error: "Credencial de LigronPi no válida.", status: 401 };
    const device = await findDeviceByUuid(env.DB, uuid);
    if (!device || !isPi(device)) return { error: "LigronPi no encontrada.", status: 404 };
    return { uuid, device };
}

export async function deviceUpdates(request, env) {
    try {
        if (request.method === "GET") {
            const url = new URL(request.url);
            const receiver = await authenticatedPi(env, request, url.searchParams.get("device_uuid"));
            if (receiver.error) return response({ success: false, error: receiver.error }, receiver.status);

            const release = await env.DB.prepare(`
                SELECT id, version, source_kind, package_url, package_sha256, package_size, created_at
                FROM device_update_releases
                WHERE usuario_id=?1 AND channel='development' AND active=1
                ORDER BY datetime(created_at) DESC
                LIMIT 1
            `).bind(receiver.device.usuario_id).first();

            if (!release) return response({ success: true, update: null });
            return response({
                success: true,
                update: {
                    id: release.id,
                    version: release.version,
                    source_kind: release.source_kind,
                    package_url: release.package_url,
                    package_sha256: release.package_sha256,
                    package_size: Number(release.package_size || 0),
                    published_at: release.created_at
                }
            });
        }

        if (request.method === "POST") {
            const user = await requireUserSession(request, env.DB);
            if (!user) return response({ success: false, error: "Sesión de Link no válida o caducada." }, 401);
            const body = await request.json();
            const version = String(body.version || "").trim();
            const channel = String(body.channel || "development").trim().toLowerCase();
            const sourceKind = String(body.source_kind || "").trim();
            const packageUrl = developmentSourceUrl(body.package_url);
            const packageHash = String(body.package_sha256 || "").trim().toLowerCase();
            const packageSize = Number(body.package_size || 0);
            if (!VERSION.test(version) || !CHANNEL.test(channel) || channel !== "development") {
                return response({ success: false, error: "Versión o canal de actualización inválido." }, 400);
            }
            if (sourceKind !== "tailnet-development" || !packageUrl || !SHA256.test(packageHash)
                || !Number.isSafeInteger(packageSize) || packageSize < 1 || packageSize > 200 * 1024 * 1024) {
                return response({ success: false, error: "Paquete de desarrollo inválido." }, 400);
            }

            const id = `upd_${crypto.randomUUID().replaceAll("-", "")}`;
            await env.DB.batch([
                env.DB.prepare(`
                    UPDATE device_update_releases SET active=0
                    WHERE usuario_id=?1 AND channel=?2 AND active=1
                `).bind(user.id, channel),
                env.DB.prepare(`
                    INSERT INTO device_update_releases
                        (id, usuario_id, channel, version, source_kind, package_url, package_sha256, package_size, published_by_usuario_id)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?2)
                `).bind(id, user.id, channel, version, sourceKind, packageUrl, packageHash, packageSize)
            ]);
            return response({ success: true, update_id: id, version, channel });
        }

        return response({ success: false, error: "Método no permitido." }, 405);
    } catch (error) {
        return response({ success: false, error: String(error?.message || error) }, 500);
    }
}
