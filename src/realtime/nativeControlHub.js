// Un canal persistente por Native. D1 conserva el estado; este objeto sólo
// entrega avisos después de que ese estado haya sido confirmado.
export class NativeControlHub {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
    }

    async fetch(request) {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected WebSocket upgrade", { status: 426 });
        }
        const nativeUuid = String(request.headers.get("X-Ligron-Native") || "").trim();
        if (!nativeUuid) return new Response("Missing Native identity", { status: 400 });
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server, [nativeUuid]);
        server.send(JSON.stringify({ type: "control.connected", native_uuid: nativeUuid }));
        return new Response(null, { status: 101, webSocket: client });
    }

    async notify(event) {
        const payload = JSON.stringify({
            type: String(event?.type || "control.sync"),
            data: event?.data && typeof event.data === "object" ? event.data : {},
            at: new Date().toISOString()
        });
        for (const socket of this.ctx.getWebSockets()) {
            try { socket.send(payload); } catch { socket.close(1011, "send failed"); }
        }
    }

    webSocketMessage(socket, message) {
        // No se aceptan órdenes por socket: las mutaciones se validan por las
        // APIs HTTPS y quedan registradas en D1.
        if (String(message) === "ping") socket.send("pong");
    }
}

export async function notifyNativeControl(env, nativeUuid, type, data = {}) {
    if (!env.NATIVE_CONTROL_HUB || !nativeUuid) return;
    try {
        await env.NATIVE_CONTROL_HUB.getByName(String(nativeUuid)).notify({ type, data });
    } catch (error) {
        // El aviso es de baja latencia; la transición ya está persistida y se
        // reconciliará al reconectar si el equipo estaba desconectado.
        console.warn("Native control notification deferred:", error?.message || error);
    }
}
