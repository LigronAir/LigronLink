import { THUMBNAIL_POLICY, reserveR2Operation, retainLatestSnapshots, utcMonthKey } from "./policy.js";

// Autoridad única por cuenta: evita que dos actualizaciones reserven la misma
// cuota o conserven más de tres objetos del mismo origen.
export class ThumbnailHub {
    constructor(ctx) {
        this.ctx = ctx;
        ctx.blockConcurrencyWhile(async () => {
            ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS thumbnail_usage (month TEXT PRIMARY KEY, class_a INTEGER NOT NULL, class_b INTEGER NOT NULL);`);
            ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS thumbnail_history (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
        });
    }

    async fetch(request) {
        const { operation, args } = await request.json();
        if (!["reserve", "reserveRead", "recordSnapshot"].includes(operation)) {
            return new Response(null, { status: 400 });
        }
        return Response.json(await this[operation](...args));
    }

    async reserve(accountId, originKey, nowMs = Date.now()) {
        const month = utcMonthKey(new Date(nowMs));
        const usage = Array.from(this.ctx.storage.sql.exec(`SELECT class_a AS classA, class_b AS classB FROM thumbnail_usage WHERE month=?`, month))[0] || { classA: 0, classB: 0 };
        const next = reserveR2Operation(usage, "put");
        if (!next) return { ok: false, code: "R2_BUDGET_EXHAUSTED" };
        this.ctx.storage.sql.exec(`INSERT INTO thumbnail_usage(month,class_a,class_b) VALUES(?,?,?) ON CONFLICT(month) DO UPDATE SET class_a=excluded.class_a,class_b=excluded.class_b`, month, next.classA, next.classB);
        const key = `origin:${accountId}:${originKey}`;
        const row = Array.from(this.ctx.storage.sql.exec(`SELECT value FROM thumbnail_history WHERE key=?`, key))[0];
        let history = []; try { history = JSON.parse(row?.value || "[]"); } catch { history = []; }
        return { ok: true, historyKey: key, history, maxBytes: THUMBNAIL_POLICY.maxBytes };
    }

    async recordSnapshot(historyKey, snapshot) {
        const row = Array.from(this.ctx.storage.sql.exec(`SELECT value FROM thumbnail_history WHERE key=?`, historyKey))[0];
        let old = []; try { old = JSON.parse(row?.value || "[]"); } catch { old = []; }
        const result = retainLatestSnapshots(old, snapshot);
        this.ctx.storage.sql.exec(`INSERT INTO thumbnail_history(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, historyKey, JSON.stringify(result.retained));
        return result;
    }

    async reserveRead(nowMs = Date.now()) {
        const month = utcMonthKey(new Date(nowMs));
        const usage = Array.from(this.ctx.storage.sql.exec(`SELECT class_a AS classA, class_b AS classB FROM thumbnail_usage WHERE month=?`, month))[0] || { classA: 0, classB: 0 };
        const next = reserveR2Operation(usage, "get");
        if (!next) return { ok: false, code: "R2_BUDGET_EXHAUSTED" };
        this.ctx.storage.sql.exec(`INSERT INTO thumbnail_usage(month,class_a,class_b) VALUES(?,?,?) ON CONFLICT(month) DO UPDATE SET class_a=excluded.class_a,class_b=excluded.class_b`, month, next.classA, next.classB);
        return { ok: true };
    }
}
