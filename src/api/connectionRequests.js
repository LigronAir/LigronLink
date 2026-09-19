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

export async function connectionRequest(request, env) {
    try {
        const body = await request.json();
        const { account, device: pi, deviceUuid } = await identity(request, env, body);
        const nativeUuid = String(body.native_device_uuid || "").trim();
        const native = await findDeviceByUuid(env.DB, nativeUuid);
        if (!native || Number(native.usuario_id) !== Number(account.id) || !String(native.tipo || "").toLowerCase().includes("ligronair")) throw new Error("Destino Native no disponible.");
        const requestId = `conn_${crypto.randomUUID()}`;
        await env.DB.prepare(`INSERT INTO connection_requests (request_id, usuario_id, pi_device_uuid, native_device_uuid, requested_transport, state, expires_at) VALUES (?1,?2,?3,?4,'AUTO','PENDING',datetime('now','+90 seconds'))`)
            .bind(requestId, account.id, deviceUuid, nativeUuid).run();
        return Response.json({ success: true, request: { request_id: requestId, state: "PENDING", destination_device_uuid: nativeUuid } }, { headers });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 400, headers }); }
}

export async function connectionPoll(request, env) {
    try {
        const { account, deviceUuid } = await identity(request, env);
        const rows = await env.DB.prepare(`SELECT * FROM connection_requests WHERE usuario_id=?1 AND native_device_uuid=?2 AND datetime(expires_at)>datetime('now') AND state IN ('PENDING','ACTIVATION_REQUESTED') ORDER BY created_at ASC`)
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
        const pending = await env.DB.prepare(`SELECT * FROM connection_requests WHERE request_id=?1 AND usuario_id=?2 AND native_device_uuid=?3 AND state IN ('PENDING','ACTIVATION_REQUESTED') AND datetime(expires_at)>datetime('now')`)
            .bind(requestId, account.id, deviceUuid).first();
        if (!pending) throw new Error("La solicitud ya no está pendiente.");
        const receiver = await env.DB.prepare(`UPDATE srt_destinos SET estado='RESERVED', reservado_por_uuid=?1, ultima_actualizacion=datetime('now') WHERE equipo_uuid=?2 AND usuario_id=?3 AND source_id=?4 AND estado='FREE' RETURNING host, port, source_id, nombre`)
            .bind(pending.pi_device_uuid, deviceUuid, account.id, sourceId).first();
        if (!receiver) throw new Error("La caja seleccionada ya no está libre.");
        await env.DB.prepare(`UPDATE connection_requests SET source_id=?2, host=?3, port=?4, active_transport='DIRECT_IPV4', state='READY', updated_at=datetime('now') WHERE request_id=?1`)
            .bind(requestId, receiver.source_id, receiver.host, receiver.port).run();
        return Response.json({ success: true, request_id: requestId, state: "READY" }, { headers });
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
