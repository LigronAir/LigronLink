import { findDeviceByUuid } from "../database/devices.js";
import { requireDeviceCredential } from "../security/deviceCredentials.js";

const headers = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store"
};

export async function deviceBootstrap(request, env) {
    try {
        const url = new URL(request.url);
        const deviceUuid = String(url.searchParams.get("device_uuid") || "").trim();
        const credential = await requireDeviceCredential(request, env.DB, deviceUuid);
        const device = credential && await findDeviceByUuid(env.DB, deviceUuid);
        if (!device || !String(device.tipo || "").trim().toLowerCase().includes("ligronpi")) {
            return Response.json({ success: false, error: "Credencial de LigronPi no válida." }, { status: 401, headers });
        }
        // La tabla equipos mantiene actualmente un único propietario. El
        // leasing multi-cuenta sustituirá esta resolución sin cambiar el
        // secreto ni el arranque de la Pi.
        const owner = await env.DB.prepare(`
            SELECT id, email, nombre, estado FROM usuarios WHERE id=?1 LIMIT 1
        `).bind(device.usuario_id).first();
        if (!owner || String(owner.estado || "ACTIVO").toUpperCase() !== "ACTIVO") {
            return Response.json({ success: false, error: "La cuenta operativa de la Pi no está disponible." }, { status: 403, headers });
        }
        return Response.json({
            success: true,
            device: { uuid: device.uuid, alias: device.alias, tipo: device.tipo },
            account: { email: owner.email, nombre: owner.nombre }
        }, { headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}
