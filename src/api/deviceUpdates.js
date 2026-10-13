import { findDeviceByUuid } from "../database/devices.js";
import { requireDeviceCredential } from "../security/deviceCredentials.js";
import { requireUserSession } from "../security/sessions.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-LigronPi-Version, X-LigronPi-Channel, X-LigronPi-Sha256, X-LigronPi-Package-Size"
};

const SHA256 = /^[a-f0-9]{64}$/i;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CHANNEL = /^[a-z][a-z0-9_-]{0,31}$/;
// El primer flujo R2 evita multipart para no introducir credenciales S3 en
// equipos ni navegadores. Si algún día el paquete supera este umbral, se
// añadirá subida multipart privada, no una excepción insegura.
const MAX_PACKAGE_BYTES = 95 * 1024 * 1024;

function response(payload, status = 200) {
    return Response.json(payload, { status, headers: corsHeaders });
}

function isPi(device) {
    return ["ligronpi", "ligronpi v2", "ligron_pi"]
        .includes(String(device?.tipo || "").trim().toLowerCase());
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

function validReleaseInput(version, channel, packageHash, packageSize) {
    return VERSION.test(version)
        && CHANNEL.test(channel)
        && channel === "development"
        && SHA256.test(packageHash)
        && Number.isSafeInteger(packageSize)
        && packageSize > 0
        && packageSize <= MAX_PACKAGE_BYTES;
}

function releaseObjectKey(userId, packageHash) {
    // La clave se deriva del hash: reintentar la misma subida no genera una
    // colección de copias ni hace posible sobrescribir otro contenido.
    return `ligronpi/${Number(userId)}/sha256/${packageHash.toLowerCase()}.zip`;
}

function packageUrl(request, releaseId, deviceUuid) {
    const url = new URL(request.url);
    url.pathname = `/api/v1/device/update/package/${encodeURIComponent(releaseId)}`;
    url.search = new URLSearchParams({ device_uuid: deviceUuid }).toString();
    return url.toString();
}

export async function deviceUpdatePackage(request, env, releaseId) {
    try {
        if (request.method === "POST") {
            const user = await requireUserSession(request, env.DB);
            if (!user) return response({ success: false, error: "Sesión de Link no válida o caducada." }, 401);
            if (!env.LIGRONPI_RELEASES) {
                return response({ success: false, error: "El almacenamiento privado de actualizaciones aún no está activo." }, 503);
            }

            const version = String(request.headers.get("X-LigronPi-Version") || "").trim();
            const channel = String(request.headers.get("X-LigronPi-Channel") || "development").trim().toLowerCase();
            const packageHash = String(request.headers.get("X-LigronPi-Sha256") || "").trim().toLowerCase();
            const packageSize = Number(request.headers.get("X-LigronPi-Package-Size") || 0);
            const contentLength = Number(request.headers.get("Content-Length") || 0);
            if (!validReleaseInput(version, channel, packageHash, packageSize)
                || !Number.isSafeInteger(contentLength) || contentLength !== packageSize
                || !request.body) {
                return response({ success: false, error: "Paquete de desarrollo inválido." }, 400);
            }

            const objectKey = releaseObjectKey(user.id, packageHash);
            const object = await env.LIGRONPI_RELEASES.put(objectKey, request.body, {
                httpMetadata: {
                    contentType: "application/zip",
                    contentDisposition: `attachment; filename="ligronpi-${version}.zip"`
                },
                customMetadata: {
                    sha256: packageHash,
                    version,
                    owner_user_id: String(user.id)
                }
            });
            if (!object || object.size !== packageSize) {
                return response({ success: false, error: "R2 no confirmó el tamaño del paquete recibido." }, 502);
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
                    VALUES (?1, ?2, ?3, ?4, 'r2-private', ?5, ?6, ?7, ?2)
                `).bind(id, user.id, channel, version, objectKey, packageHash, packageSize)
            ]);
            return response({ success: true, update_id: id, version, channel, package_size: packageSize });
        }

        if (request.method !== "GET") {
            return response({ success: false, error: "Método no permitido." }, 405);
        }
        const url = new URL(request.url);
        const receiver = await authenticatedPi(env, request, url.searchParams.get("device_uuid"));
        if (receiver.error) return response({ success: false, error: receiver.error }, receiver.status);
        const release = await env.DB.prepare(`
            SELECT id, package_url, package_sha256, package_size
            FROM device_update_releases
            WHERE id=?1 AND usuario_id=?2 AND active=1 AND source_kind='r2-private'
            LIMIT 1
        `).bind(releaseId, receiver.device.usuario_id).first();
        if (!release || !env.LIGRONPI_RELEASES) {
            return response({ success: false, error: "La actualización solicitada no está disponible." }, 404);
        }
        const object = await env.LIGRONPI_RELEASES.get(release.package_url);
        if (!object || object.size !== Number(release.package_size)
            || object.customMetadata?.sha256?.toLowerCase() !== release.package_sha256.toLowerCase()) {
            return response({ success: false, error: "El paquete privado no supera la verificación de Link." }, 503);
        }
        return new Response(object.body, {
            headers: {
                "Content-Type": "application/zip",
                "Content-Length": String(object.size),
                "Content-Disposition": object.httpMetadata?.contentDisposition || "attachment; filename=ligronpi.zip",
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff"
            }
        });
    } catch (error) {
        return response({ success: false, error: String(error?.message || error) }, 500);
    }
}

export async function deviceUpdates(request, env) {
    try {
        if (request.method === "GET") {
            const url = new URL(request.url);
            const receiver = await authenticatedPi(env, request, url.searchParams.get("device_uuid"));
            if (receiver.error) return response({ success: false, error: receiver.error }, receiver.status);

            const release = await env.DB.prepare(`
                SELECT id, version, source_kind, package_sha256, package_size, created_at
                FROM device_update_releases
                WHERE usuario_id=?1 AND channel='development' AND active=1 AND source_kind='r2-private'
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
                    package_url: packageUrl(request, release.id, receiver.uuid),
                    package_sha256: release.package_sha256,
                    package_size: Number(release.package_size || 0),
                    published_at: release.created_at
                }
            });
        }

        if (request.method === "POST") {
            // La publicación se hace por POST /device/update/package: el ZIP
            // debe entrar primero en R2 privado. Este endpoint no acepta URLs
            // externas para evitar que una Pi termine descargando de un PC.
            return response({
                success: false,
                error: "Suba el ZIP mediante /device/update/package; Link no acepta URLs externas de actualización."
            }, 409);
        }

        return response({ success: false, error: "Método no permitido." }, 405);
    } catch (error) {
        return response({ success: false, error: String(error?.message || error) }, 500);
    }
}
