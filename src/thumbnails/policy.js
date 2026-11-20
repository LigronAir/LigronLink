export const THUMBNAIL_POLICY = Object.freeze({
    maxWidth: 160,
    maxHeight: 90,
    maxBytes: 16 * 1024,
    maxTargetsPerRefresh: 10,
    maxSnapshotsPerOrigin: 3,
    // Una sesión Pool visible puede pedir una fotografía cada dos minutos.
    // El límite es de cuenta, así que dos pestañas no duplican capturas.
    minRefreshIntervalMs: 120_000,
    requestLifetimeMs: 30_000,
    // Techo conservador frente al Free tier de R2 (1M/10M): protege la
    // cuota compartida con producción y se puede ajustar por entorno.
    maxR2ClassAOperationsPerMonth: 30_000,
    maxR2ClassBOperationsPerMonth: 60_000,
});

export function utcDayKey(now = new Date()) { return now.toISOString().slice(0, 10); }
export function utcMonthKey(now = new Date()) { return now.toISOString().slice(0, 7); }

export function mayRefresh(lastRefreshAtMs, nowMs) {
    return !Number.isFinite(lastRefreshAtMs)
        || nowMs - lastRefreshAtMs >= THUMBNAIL_POLICY.minRefreshIntervalMs;
}

export function reserveR2Operation(usage, operation, limits = THUMBNAIL_POLICY) {
    const next = { classA: Number(usage?.classA || 0), classB: Number(usage?.classB || 0) };
    if (operation === "put") next.classA += 1;
    else if (operation === "get") next.classB += 1;
    else throw new TypeError("Operación R2 no permitida.");
    return next.classA <= limits.maxR2ClassAOperationsPerMonth
        && next.classB <= limits.maxR2ClassBOperationsPerMonth ? next : null;
}

// El cuarto frame expulsa el primero. El caller borra cada clave expirada sin ListObjects.
export function retainLatestSnapshots(existing, snapshot) {
    const history = Array.isArray(existing) ? existing : [];
    if (history.includes(snapshot)) return { retained: history, expired: [] };
    const items = [...history, snapshot];
    return { retained: items.slice(-THUMBNAIL_POLICY.maxSnapshotsPerOrigin),
        expired: items.slice(0, -THUMBNAIL_POLICY.maxSnapshotsPerOrigin) };
}
