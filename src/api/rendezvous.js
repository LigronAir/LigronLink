// ### FIX — SRT RENDEZVOUS
import { findDeviceByUuid } from "../database/devices.js";
import { findUserByEmail } from "../database/users.js";

const corsHeaders = { "Access-Control-Allow-Origin": "https://ligronair.tv", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const activeStates = ["CREATED", "WAITING_PI", "WAITING_NATIVE", "READY", "STARTING", "CONNECTING"];

async function user(request, env, body = null) {
    const url = new URL(request.url);
    const email = String(body?.email || url.searchParams.get("email") || "").trim().toLowerCase();
    const deviceUuid = String(body?.device_uuid || url.searchParams.get("device_uuid") || "").trim();
    const account = email && await findUserByEmail(env.DB, email);
    const device = account && deviceUuid && await findDeviceByUuid(env.DB, deviceUuid);
    if (!account || !device || Number(device.usuario_id) !== Number(account.id)) throw new Error("Dispositivo no autorizado.");
    return { account, deviceUuid };
}

export async function rendezvousPoll(request, env) {
    try {
        const { account, deviceUuid } = await user(request, env);
        const rows = await env.DB.prepare(`SELECT * FROM rendezvous_sessions WHERE usuario_id=?1 AND (source_device_uuid=?2 OR destination_device_uuid=?2) AND datetime(expires_at) > datetime('now') AND state NOT IN ('FAILED','CANCELLED','EXPIRED') ORDER BY created_at DESC`).bind(account.id, deviceUuid).all();
        return Response.json({ success: true, sessions: rows.results || [] }, { headers: corsHeaders });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 403, headers: corsHeaders }); }
}

export async function rendezvousReady(request, env) {
    try {
        const body = await request.json();
        const { account, deviceUuid } = await user(request, env, body);
        const id = String(body.session_id || "").trim();
        const session = await env.DB.prepare(`SELECT * FROM rendezvous_sessions WHERE session_id=?1 AND usuario_id=?2`).bind(id, account.id).first();
        if (!session || !activeStates.includes(session.state)) throw new Error("Sesión Rendezvous no disponible.");
        const pi = session.source_device_uuid === deviceUuid;
        const native = session.destination_device_uuid === deviceUuid;
        if (!pi && !native) throw new Error("Dispositivo ajeno a la sesión.");
        await env.DB.prepare(`UPDATE rendezvous_sessions SET pi_ready=CASE WHEN ?2 THEN 1 ELSE pi_ready END, native_ready=CASE WHEN ?3 THEN 1 ELSE native_ready END, state=CASE WHEN (pi_ready=1 OR ?2) AND (native_ready=1 OR ?3) THEN 'STARTING' WHEN ?2 THEN 'WAITING_NATIVE' ELSE 'WAITING_PI' END, updated_at=datetime('now') WHERE session_id=?1`).bind(id, pi ? 1 : 0, native ? 1 : 0).run();
        const updated = await env.DB.prepare(`SELECT * FROM rendezvous_sessions WHERE session_id=?1`).bind(id).first();
        return Response.json({ success: true, session: updated }, { headers: corsHeaders });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 400, headers: corsHeaders }); }
}

export async function rendezvousResult(request, env) {
    try {
        const body = await request.json();
        const { account, deviceUuid } = await user(request, env, body);
        const state = ["CONNECTED", "FAILED", "CANCELLED"].includes(String(body.state || "")) ? String(body.state) : "FAILED";
        await env.DB.prepare(`UPDATE rendezvous_sessions SET state=?3, updated_at=datetime('now') WHERE session_id=?1 AND usuario_id=?2 AND (?4=source_device_uuid OR ?4=destination_device_uuid)`).bind(String(body.session_id || ""), account.id, state, deviceUuid).run();
        return Response.json({ success: true }, { headers: corsHeaders });
    } catch (error) { return Response.json({ success: false, error: error.message }, { status: 400, headers: corsHeaders }); }
}
