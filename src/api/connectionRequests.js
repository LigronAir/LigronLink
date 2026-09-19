// ### FIX — NATIVE-OWNED CONNECTION ORCHESTRATION
import { findDeviceByUuid } from "../database/devices.js";
import { findUserByEmail } from "../database/users.js";

const headers = { "Access-Control-Allow-Origin": "https://ligronair.tv", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

async function identity(request, env, body = null) {
    const url = new URL(request.url);
    const email = String(body?.email || url.searchParams.get("email") || "").trim().toLowerCase();
    const deviceUuid = String(body?.device_uuid || url.searchParams.get("device_uuid") || "").trim();
    const account = email && await findUserByEmail(env.DB, email);
    const device = account && deviceUuid && await findDeviceByUuid(env.DB, deviceUuid);
    if (!account || !device || Number(device.usuario_id) !== Number(account.id)) throw new Error("Dispositivo no autorizado.");
    return { account, device, deviceUuid };
}

function privateV4(value) {
    const octets = String(value || "").split(".").map(Number);
    if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return false;
    return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}

function sameLan(left, right) {
    return privateV4(left) && privateV4(right) && left.split(".").slice(0, 3).join(".") === right.split(".").slice(0, 3).join(".");
}

async function capabilities(env, uuid) {
    const row = await env.DB.prepare("SELECT capabilities_json FROM device_network_capabilities WHERE device_uuid=?1").bind(uuid).first();
    try { return JSON.parse(row?.capabilities_json || "{}"); } catch { return {}; }
}

// Pi must expose a listener before Native is told to call.  The route is
// selected from addresses actually reported by both endpoints; a shared
// public IPv4 is never presented as a usable peer address (hairpin trap).
async function reverseCallerRoute(env, pi, native, requestId) {
    const [piCaps, nativeCaps] = await Promise.all([capabilities(env, pi.uuid), capabilities(env, native.uuid)]);
    const piV6 = String(piCaps.ipv6_address || "").trim();
    const nativeV6 = String(nativeCaps.ipv6_address || "").trim();
    let host = "";
    let transport = "";
    if (piCaps.srt_ipv6 === true && nativeCaps.srt_ipv6 === true && piCaps.ipv6_internet === true && nativeCaps.ipv6_internet === true && piV6) {
        host = piV6;
        transport = "IPV6_REVERSE_CALLER";
    } else {
        const piLan = String(piCaps.ipv4_address || "").trim();
        const nativeLan = String(nativeCaps.ipv4_address || "").trim();
        if (sameLan(piLan, nativeLan)) {
            host = piLan;
            transport = "LAN_REVERSE_CALLER";
        } else if (String(pi.public_ip || "").trim() && String(pi.public_ip || "").trim() !== String(native.public_ip || "").trim()) {
            host = String(pi.public_ip).trim();
            transport = "IPV4_REVERSE_CALLER";
        }
    }
    if (!host) throw new Error("No hay una ruta alcanzable para que Native llame a Pi: IPv6 global no disponible y la IPv4 pública compartida no admite hairpin. Registre ambos extremos en la misma LAN o use IPv6 global.");
    // Deterministic per request, and separate from Native's normal box ports.
    const port = 13000 + (Array.from(requestId).reduce((value, character) => value + character.charCodeAt(0), 0) % 1000);
    return { host, port, transport };
}

export async function connectionRequest(request, env) {
    try {
        const body = await request.json();
        const { account, device: pi, deviceUuid } = await identity(request, env, body);
        const nativeUuid = String(body.native_device_uuid || "").trim();
        const native = await findDeviceByUuid(env.DB, nativeUuid);
        if (!native || Number(native.usuario_id) !== Number(account.id) || !String(native.tipo || "").toLowerCase().includes("ligronair")) throw new Error("Destino Native no disponible.");
        const requestId = `conn_${crypto.randomUUID()}`;
        const route = await reverseCallerRoute(env, pi, native, requestId);
        await env.DB.prepare(`INSERT INTO connection_requests (request_id, usuario_id, pi_device_uuid, native_device_uuid, host, port, requested_transport, active_transport, state, expires_at) VALUES (?1,?2,?3,?4,?5,?6,'REVERSE_CALLER',?7,'PENDING',datetime('now','+90 seconds'))`)
            .bind(requestId, account.id, deviceUuid, nativeUuid, route.host, route.port, route.transport).run();
        return Response.json({ success: true, request: { request_id: requestId, state: "PENDING", destination_device_uuid: nativeUuid, host: route.host, port: route.port, route: "REVERSE_CALLER", transport: route.transport } }, { headers });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 400, headers }); }
}

export async function connectionPoll(request, env) {
    try {
        const { account, deviceUuid } = await identity(request, env);
        const rows = await env.DB.prepare(`SELECT * FROM connection_requests WHERE usuario_id=?1 AND native_device_uuid=?2 AND datetime(expires_at)>datetime('now') AND state IN ('PENDING','BOX_READY','PI_READY','CALLER_REQUIRED') ORDER BY created_at ASC`)
            .bind(account.id, deviceUuid).all();
        return Response.json({ success: true, requests: rows.results || [] }, { headers });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 403, headers }); }
}

export async function connectionClaim(request, env) {
    try {
        const body = await request.json();
        const { account, deviceUuid } = await identity(request, env, body);
        const requestId = String(body.request_id || "").trim();
        const sourceId = Number(body.source_id);
        if (!requestId || !Number.isInteger(sourceId)) throw new Error("Solicitud o caja inválida.");
        const pending = await env.DB.prepare(`SELECT * FROM connection_requests WHERE request_id=?1 AND usuario_id=?2 AND native_device_uuid=?3 AND state IN ('PENDING','PI_READY') AND datetime(expires_at)>datetime('now')`)
            .bind(requestId, account.id, deviceUuid).first();
        if (!pending) throw new Error("La solicitud ya no está pendiente.");
        const receiver = await env.DB.prepare(`UPDATE srt_destinos SET estado='RESERVED', reservado_por_uuid=?1, ultima_actualizacion=datetime('now') WHERE equipo_uuid=?2 AND usuario_id=?3 AND source_id=?4 AND estado='FREE' RETURNING host, port, source_id, nombre`)
            .bind(pending.pi_device_uuid, deviceUuid, account.id, sourceId).first();
        if (!receiver) throw new Error("La caja seleccionada ya no está libre.");
        const state = pending.state === "PI_READY" ? "CALLER_REQUIRED" : "BOX_READY";
        await env.DB.prepare(`UPDATE connection_requests SET source_id=?2, state=?3, updated_at=datetime('now') WHERE request_id=?1`)
            .bind(requestId, receiver.source_id, state).run();
        return Response.json({ success: true, request_id: requestId, source_id: receiver.source_id, host: pending.host, port: pending.port, state }, { headers });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 409, headers }); }
}

export async function connectionStatus(request, env) {
    try {
        const { account, deviceUuid } = await identity(request, env);
        const id = new URL(request.url).searchParams.get("request_id");
        const row = await env.DB.prepare(`SELECT * FROM connection_requests WHERE request_id=?1 AND usuario_id=?2 AND pi_device_uuid=?3`)
            .bind(String(id || ""), account.id, deviceUuid).first();
        if (!row) throw new Error("Solicitud no encontrada.");
        return Response.json({ success: true, request: row }, { headers });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 404, headers }); }
}

export async function connectionActivate(request, env) {
    try {
        const body = await request.json();
        const { account, deviceUuid } = await identity(request, env, body);
        const id = String(body.request_id || "");
        const row = await env.DB.prepare(`UPDATE connection_requests SET activation_requested=1, state='ACTIVATION_REQUESTED', updated_at=datetime('now') WHERE request_id=?1 AND usuario_id=?2 AND (?3=pi_device_uuid OR ?3=native_device_uuid) AND state='PENDING' RETURNING request_id`)
            .bind(id, account.id, deviceUuid).first();
        if (!row) throw new Error("La solicitud no se puede activar.");
        return Response.json({ success: true, request_id: id, state: "ACTIVATION_REQUESTED" }, { headers });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 409, headers }); }
}

export async function connectionReady(request, env) {
    try {
        const body = await request.json();
        const { account, deviceUuid } = await identity(request, env, body);
        const requestId = String(body.request_id || "").trim();
        const row = await env.DB.prepare(`UPDATE connection_requests SET state=CASE WHEN source_id IS NULL THEN 'PI_READY' ELSE 'CALLER_REQUIRED' END, updated_at=datetime('now') WHERE request_id=?1 AND usuario_id=?2 AND pi_device_uuid=?3 AND state IN ('PENDING','BOX_READY') AND datetime(expires_at)>datetime('now') RETURNING request_id, source_id, host, port, state`)
            .bind(requestId, account.id, deviceUuid).first();
        if (!row) throw new Error("La solicitud no está disponible para iniciar la llamada.");
        return Response.json({ success: true, request: row }, { headers });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 409, headers }); }
}
