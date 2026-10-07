import { findDeviceByUuid } from "../database/devices.js";
import { requireUserSession } from "../security/sessions.js";
import { issueDeviceCredential, revokeDeviceCredential } from "../security/deviceCredentials.js";

const headers = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store"
};

function isLigronPi(device) {
    return ["ligronpi", "ligronpi native", "ligronpi_native"]
        .includes(String(device?.tipo || "").trim().toLowerCase());
}

export async function deviceCredential(request, env) {
    try {
        const user = await requireUserSession(request, env.DB);
        if (!user) {
            return Response.json({ success: false, error: "Sesión no válida o caducada." }, { status: 401, headers });
        }
        const body = await request.json();
        const deviceUuid = String(body.device_uuid || "").trim();
        const device = deviceUuid && await findDeviceByUuid(env.DB, deviceUuid);
        if (!device || Number(device.usuario_id) !== Number(user.id) || !isLigronPi(device)) {
            return Response.json({ success: false, error: "LigronPi no autorizada para esta cuenta." }, { status: 403, headers });
        }
        if (request.method === "DELETE") {
            return Response.json({ success: true, revoked: await revokeDeviceCredential(env.DB, deviceUuid) }, { headers });
        }
        if (request.method !== "POST") {
            return Response.json({ success: false, error: "Método no permitido." }, { status: 405, headers });
        }
        const token = await issueDeviceCredential(env.DB, deviceUuid);
        return Response.json({
            success: true,
            device_uuid: deviceUuid,
            credential: token,
            warning: "Se muestra una única vez. Guárdela sólo mediante el provisionado cifrado de la Pi."
        }, { headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}
