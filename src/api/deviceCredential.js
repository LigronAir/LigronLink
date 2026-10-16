import { findDeviceByUuid } from "../database/devices.js";
import { requireUserSession } from "../security/sessions.js";
import { revokeDeviceCredential } from "../security/deviceCredentials.js";
import { revokeLigronTailDevice } from "./ligronTailBootstrap.js";

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
            const revoked = await revokeDeviceCredential(env.DB, deviceUuid);
            const ligronTail = await revokeLigronTailDevice(env, deviceUuid);
            return Response.json({ success: true, revoked, ligron_tail: ligronTail }, { headers });
        }
        return Response.json({
            success: false,
            error: "La credencial de LigronPi se renueva automáticamente desde la Pi; ya no se puede copiar desde el panel."
        }, { status: 410, headers });
    } catch (error) {
        return Response.json({ success: false, error: String(error?.message || error) }, { status: 500, headers });
    }
}
