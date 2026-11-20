import { requireUserSession } from "../security/sessions.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "https://ligronair.tv",
    "Cache-Control": "no-store"
};

function protocolToken(request) {
    // El navegador no permite Authorization al abrir un WebSocket. La sesión
    // opaca se pasa como subprotocolo (no queda en URL, historial ni Referer).
    const values = String(request.headers.get("Sec-WebSocket-Protocol") || "")
        .split(",").map(value => value.trim());
    return values.find(value => /^[A-Za-z0-9_-]{32,}$/.test(value)) || "";
}

export async function poolEvents(request, env) {
    if (request.headers.get("Upgrade") !== "websocket") {
        return Response.json({ success: false, error: "WebSocket required" }, { status: 426, headers: corsHeaders });
    }
    const token = protocolToken(request);
    const authenticated = new Request(request.url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const user = await requireUserSession(authenticated, env.DB);
    if (!user) {
        return Response.json({ success: false, error: "Sesión no válida o caducada." }, { status: 401, headers: corsHeaders });
    }
    if (!env.POOL_EVENT_HUB) {
        return Response.json({ success: false, error: "Eventos Pool no disponibles." }, { status: 503, headers: corsHeaders });
    }
    const headers = new Headers(request.headers);
    headers.set("X-Ligron-Account", String(user.id));
    return env.POOL_EVENT_HUB.getByName(`account:${user.id}`).fetch(
        new Request(request, { headers })
    );
}
