// Identidad persistente de un equipo. El secreto se entrega una única vez
// durante el provisionado y D1 conserva exclusivamente su hash.

function tokenBase64Url(bytes = 32) {
    const value = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...value))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
}

export async function credentialHash(token) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deviceToken(request) {
    const value = String(request.headers.get("Authorization") || "");
    const match = /^Device\s+([A-Za-z0-9_-]{32,})$/i.exec(value);
    return match ? match[1] : "";
}

export async function issueDeviceCredential(db, deviceUuid) {
    const token = tokenBase64Url();
    await db.prepare(`
        INSERT INTO device_credentials (device_uuid, token_hash, created_at, last_used_at, revoked_at)
        VALUES (?1, ?2, datetime('now'), NULL, NULL)
        ON CONFLICT(device_uuid) DO UPDATE SET
            token_hash=excluded.token_hash,
            created_at=datetime('now'),
            last_used_at=NULL,
            revoked_at=NULL
    `).bind(deviceUuid, await credentialHash(token)).run();
    return token;
}

export async function revokeDeviceCredential(db, deviceUuid) {
    const result = await db.prepare(`
        UPDATE device_credentials
        SET revoked_at=datetime('now')
        WHERE device_uuid=?1 AND revoked_at IS NULL
    `).bind(deviceUuid).run();
    return Number(result.meta?.changes || 0) > 0;
}

export async function requireDeviceCredential(request, db, deviceUuid) {
    const token = deviceToken(request);
    if (!token || !deviceUuid) return null;
    const credential = await db.prepare(`
        SELECT device_uuid
        FROM device_credentials
        WHERE device_uuid=?1 AND token_hash=?2 AND revoked_at IS NULL
        LIMIT 1
    `).bind(deviceUuid, await credentialHash(token)).first();
    if (!credential) return null;
    // Sólo el arranque y los usos explícitos actualizan este campo; no se
    // escribe por cada heartbeat para no elevar el consumo de D1.
    await db.prepare(`
        UPDATE device_credentials
        SET last_used_at=datetime('now')
        WHERE device_uuid=?1
    `).bind(deviceUuid).run();
    return credential;
}
