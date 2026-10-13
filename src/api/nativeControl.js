import { findDeviceByUuid } from "../database/devices.js";
import { requireUserSession } from "../security/sessions.js";
import { requireDeviceCredential } from "../security/deviceCredentials.js";

// Native abre esta conexión saliente; Link nunca necesita abrir un puerto
// hacia el PC, incluso detrás de CGNAT.
export async function nativeControl(request, env) {
    if (request.headers.get("Upgrade") !== "websocket") {
        return Response.json({ success: false, error: "Se requiere WebSocket." }, { status: 426 });
    }
    const nativeUuid = String(new URL(request.url).searchParams.get("device_uuid") || "").trim();
    const usesDeviceCredential = /^Device\s+/i.test(String(request.headers.get("Authorization") || ""));
    const credential = usesDeviceCredential && await requireDeviceCredential(request, env.DB, nativeUuid);
    const device = (credential || !usesDeviceCredential) && nativeUuid
        ? await findDeviceByUuid(env.DB, nativeUuid) : null;
    const user = credential && device
        ? await env.DB.prepare("SELECT id FROM usuarios WHERE id=?1 LIMIT 1").bind(device.usuario_id).first()
        : await requireUserSession(request, env.DB);
    const isNative = ["ligronair", "ligronair native", "ligronair_native"]
        .includes(String(device?.tipo || "").trim().toLowerCase());
    if (!user || !device || Number(device.usuario_id) !== Number(user.id) || !isNative) {
        return Response.json({ success: false, error: "Canal Native no autorizado." }, { status: 401 });
    }
    const headers = new Headers(request.headers);
    headers.set("X-Ligron-Native", nativeUuid);
    return env.NATIVE_CONTROL_HUB.getByName(nativeUuid).fetch(new Request(request, { headers }));
}
