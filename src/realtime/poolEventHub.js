// Avisos de presencia para Pool. D1 sigue siendo la fuente de verdad; este
// objeto sólo despierta las pestañas tras una transición ya persistida.
export class PoolEventHub {
    constructor(ctx) {
        this.ctx = ctx;
        ctx.blockConcurrencyWhile(async () => {
            ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS pool_device_signatures (device_uuid TEXT PRIMARY KEY, signature TEXT NOT NULL);`);
        });
    }

    async fetch(request) {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected WebSocket upgrade", { status: 426 });
        }
        const accountId = String(request.headers.get("X-Ligron-Account") || "").trim();
        if (!accountId) return new Response("Missing account", { status: 400 });
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.ctx.acceptWebSocket(server, [accountId]);
        server.send(JSON.stringify({ type: "pool.connected" }));
        return new Response(null, {
            status: 101,
            webSocket: client,
            headers: { "Sec-WebSocket-Protocol": "ligron-pool-v1" }
        });
    }

    async notify(event) {
        const deviceUuid = String(event?.device_uuid || "").trim();
        const signature = String(event?.signature || "");
        if (!deviceUuid || !signature) return;
        const existing = Array.from(this.ctx.storage.sql.exec(
            `SELECT signature FROM pool_device_signatures WHERE device_uuid=?`, deviceUuid
        ))[0];
        if (existing?.signature === signature) return;
        this.ctx.storage.sql.exec(
            `INSERT INTO pool_device_signatures(device_uuid,signature) VALUES(?,?)
             ON CONFLICT(device_uuid) DO UPDATE SET signature=excluded.signature`,
            deviceUuid, signature
        );
        const payload = JSON.stringify({
            type: "pool.device.changed",
            data: { device_uuid: deviceUuid },
            at: new Date().toISOString()
        });
        for (const socket of this.ctx.getWebSockets()) {
            try { socket.send(payload); } catch { socket.close(1011, "send failed"); }
        }
    }

    async heartbeat(deviceUuid) {
        const uuid = String(deviceUuid || "").trim();
        if (!uuid) return;
        const payload = JSON.stringify({
            type: "pool.device.alive",
            data: { device_uuid: uuid },
            at: new Date().toISOString()
        });
        for (const socket of this.ctx.getWebSockets()) {
            try { socket.send(payload); } catch { socket.close(1011, "send failed"); }
        }
    }

    webSocketMessage(socket, message) {
        if (String(message) === "ping") socket.send("pong");
    }
}

export async function notifyPoolDeviceChanged(env, accountId, event) {
    if (!env.POOL_EVENT_HUB || !accountId) return;
    try {
        await env.POOL_EVENT_HUB.getByName(`account:${accountId}`).notify(event);
    } catch (error) {
        // La presencia está confirmada en D1 aunque el aviso llegue tarde;
        // Pool se reconcilia al abrirse y en su ciclo económico de 120 s.
        console.warn("Pool presence notification deferred:", error?.message || error);
    }
}

export async function notifyPoolDeviceAlive(env, accountId, deviceUuid) {
    if (!env.POOL_EVENT_HUB || !accountId || !deviceUuid) return;
    try {
        await env.POOL_EVENT_HUB.getByName(`account:${accountId}`).heartbeat(deviceUuid);
    } catch (error) {
        console.warn("Pool heartbeat notification deferred:", error?.message || error);
    }
}
