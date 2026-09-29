// ==========================================================
// LigronLink
// LigronRelay - control plane for the public SRT relay
// ==========================================================
//
// Media never traverses the Worker.  The Worker only creates short-lived,
// per-reservation credentials and authorizes MediaMTX when it asks.  This
// keeps the control plane HTTPS-only and makes the relay the primary route
// without turning Cloudflare Workers into a video proxy.

const RELAY_HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function randomToken(bytes = 24) {
    const value = new Uint8Array(bytes);
    crypto.getRandomValues(value);
    return btoa(String.fromCharCode(...value))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function validRelayHost(value) {
    const host = String(value || "").trim().toLowerCase();
    // A stable public DNS name is deliberate: an IP literal makes rotation
    // and certificate/monitoring changes needlessly disruptive.
    return RELAY_HOST_PATTERN.test(host) ? host : "";
}

export function relayConfiguration(env) {
    const host = validRelayHost(env.LIGRONRELAY_SRT_HOST);
    const port = Number(env.LIGRONRELAY_SRT_PORT || 8890);
    const passphrase = String(env.LIGRONRELAY_SRT_PASSPHRASE || "");
    const enabled = String(env.LIGRONRELAY_ENABLED || "true").toLowerCase() !== "false";
    // MediaMTX configures SRT passphrases per path rule, not per connection.
    // Keep one relay-only secret, distinct from per-session read/write tokens.
    if (!enabled || !host || !Number.isInteger(port) || port < 1 || port > 65535 ||
        !/^[A-Za-z0-9_-]{10,79}$/.test(passphrase)) {
        return null;
    }
    return { host, port, passphrase };
}

function relayUrl(config, action, session) {
    const streamId = `${action}:${session.stream_name}:${action === "publish" ? "publisher" : "reader"}:${action === "publish" ? session.publish_token : session.read_token}`;
    const query = new URLSearchParams({
        mode: "caller",
        streamid: streamId,
        passphrase: config.passphrase,
        pbkeylen: "32",
        latency: "500000",
        pkt_size: "1316",
    });
    return `srt://${config.host}:${config.port}?${query.toString()}`;
}

export async function createRelaySession(db, config, accountId, piUuid, nativeUuid, sourceId) {
    const session = {
        session_id: `relay_${crypto.randomUUID().replace(/-/g, "")}`,
        stream_name: `ligron_${crypto.randomUUID().replace(/-/g, "")}`,
        publish_token: randomToken(),
        read_token: randomToken(),
    };
    await db.prepare(`
        INSERT INTO relay_sessions
            (session_id, usuario_id, pi_device_uuid, native_device_uuid,
             source_id, relay_host, relay_port, stream_name,
             publish_token, read_token, state, expires_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'ACTIVE', datetime('now', '+12 hours'))
    `).bind(
        session.session_id, accountId, piUuid, nativeUuid, sourceId,
        config.host, config.port, session.stream_name,
        session.publish_token, session.read_token,
    ).run();

    return {
        ...session,
        relay_host: config.host,
        relay_port: config.port,
        publish_url: relayUrl(config, "publish", session),
        read_url: relayUrl(config, "read", session),
    };
}

export async function findRelaySessionsForNative(db, accountId, nativeUuid, relay) {
    if (!relay) return [];
    let result;
    try {
        result = await db.prepare(`
            SELECT session_id, source_id, relay_host, relay_port, stream_name,
                   read_token
            FROM relay_sessions AS session
            JOIN equipos AS pi
              ON pi.uuid=session.pi_device_uuid
             AND pi.usuario_id=session.usuario_id
            WHERE session.usuario_id=?1
              AND session.native_device_uuid=?2
              AND session.state='ACTIVE'
              AND datetime(session.expires_at)>datetime('now')
              AND UPPER(pi.estado)='ONLINE'
              AND datetime(pi.ultima_conexion)>=datetime('now','-45 seconds')
            ORDER BY session.created_at ASC
        `).bind(accountId, nativeUuid).all();
    } catch (error) {
        if (String(error?.message || error).includes("no such table")) return [];
        throw error;
    }

    return (result.results || []).map((row) => {
        const config = {
            host: row.relay_host,
            port: Number(row.relay_port),
            passphrase: relay.passphrase,
        };
        return {
            session_id: row.session_id,
            source_id: Number(row.source_id),
            host: config.host,
            port: config.port,
            read_url: relayUrl(config, "read", row),
        };
    });
}

// Called only by the MediaMTX instance.  The caller proves that it is the
// configured relay with a shared secret kept outside the Worker source.
export async function ligronRelayAuth(request, env) {
    const relaySecret = String(env.LIGRONRELAY_AUTH_SECRET || "");
    const supplied = new URL(request.url).searchParams.get("relay_secret") || "";
    if (!relaySecret || supplied !== relaySecret) {
        return new Response("Forbidden", { status: 403 });
    }
    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        const body = await request.json();
        const action = String(body.action || "").toLowerCase();
        const protocol = String(body.protocol || "").toLowerCase();
        const path = String(body.path || "");
        const user = String(body.user || "");
        const password = String(body.password || "");
        if (protocol !== "srt" || !["publish", "read"].includes(action) || !path) {
            return new Response("Forbidden", { status: 403 });
        }
        const session = await env.DB.prepare(`
            SELECT publish_token, read_token
            FROM relay_sessions
            WHERE stream_name=?1 AND state='ACTIVE'
              AND datetime(expires_at)>datetime('now')
        `).bind(path).first();
        const allowed = (action === "publish" && user === "publisher" && password === String(session?.publish_token || ""))
            || (action === "read" && user === "reader" && password === String(session?.read_token || ""));
        return new Response(allowed ? "OK" : "Forbidden", { status: allowed ? 204 : 403 });
    } catch (error) {
        console.error("LigronRelay auth failed:", error?.message || error);
        return new Response("Forbidden", { status: 403 });
    }
}
