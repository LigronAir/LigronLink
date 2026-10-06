// ==========================================================
// LigronLink - sesiones de usuario opacas y revocables
// ==========================================================

const SESSION_TTL_SECONDS = 12 * 60 * 60;

function tokenBase64Url(bytes = 32) {
    const value = crypto.getRandomValues(new Uint8Array(bytes));
    return btoa(String.fromCharCode(...value))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
}

async function tokenHash(token) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function bearerToken(request) {
    const value = String(request.headers.get("Authorization") || "");
    const match = /^Bearer\s+([A-Za-z0-9_-]{32,})$/i.exec(value);
    return match ? match[1] : "";
}

export async function createUserSession(db, userId) {
    const token = tokenBase64Url();
    const id = `usr_${crypto.randomUUID().replaceAll("-", "")}`;
    await db.prepare(`
        INSERT INTO auth_sessions (id, usuario_id, token_hash, expires_at)
        VALUES (?1, ?2, ?3, datetime('now', '+12 hours'))
    `).bind(id, userId, await tokenHash(token)).run();
    return { token, expiresIn: SESSION_TTL_SECONDS };
}

export async function requireUserSession(request, db) {
    const token = bearerToken(request);
    if (!token) return null;
    return db.prepare(`
        SELECT session.id AS session_id, user.id, user.uuid, user.nombre, user.email, user.estado
        FROM auth_sessions AS session
        JOIN usuarios AS user ON user.id = session.usuario_id
        WHERE session.token_hash = ?1
          AND session.revoked_at IS NULL
          AND datetime(session.expires_at) > datetime('now')
          AND UPPER(COALESCE(user.estado, 'ACTIVO')) = 'ACTIVO'
        LIMIT 1
    `).bind(await tokenHash(token)).first();
}

export async function revokeUserSession(request, db) {
    const token = bearerToken(request);
    if (!token) return false;
    const result = await db.prepare(`
        UPDATE auth_sessions
        SET revoked_at = datetime('now')
        WHERE token_hash = ?1 AND revoked_at IS NULL
    `).bind(await tokenHash(token)).run();
    return Number(result.meta?.changes || 0) > 0;
}
