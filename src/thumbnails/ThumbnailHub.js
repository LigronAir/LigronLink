import { THUMBNAIL_POLICY, reserveR2Operation, retainLatestSnapshots, utcMonthKey } from "./policy.js";

// Autoridad única por cuenta: evita que dos actualizaciones reserven la misma
// cuota o conserven más de tres objetos del mismo origen.
export class ThumbnailHub {
    constructor(ctx) { this.ctx = ctx; }

    async reserve(accountId, originKey, nowMs = Date.now()) {
        const month = utcMonthKey(new Date(nowMs));
        const budgetKey = `budget:${month}`;
        const usage = this.ctx.storage.kv.get(budgetKey) || { classA: 0, classB: 0 };
        const next = reserveR2Operation(usage, "put");
        if (!next) return { ok: false, code: "R2_BUDGET_EXHAUSTED" };
        this.ctx.storage.kv.put(budgetKey, next);
        const key = `origin:${accountId}:${originKey}`;
        const history = this.ctx.storage.kv.get(key) || [];
        return { ok: true, historyKey: key, history, maxBytes: THUMBNAIL_POLICY.maxBytes };
    }

    async recordSnapshot(historyKey, snapshot) {
        const result = retainLatestSnapshots(this.ctx.storage.kv.get(historyKey) || [], snapshot);
        this.ctx.storage.kv.put(historyKey, result.retained);
        return result;
    }

    async reserveRead(nowMs = Date.now()) {
        const key = `budget:${utcMonthKey(new Date(nowMs))}`;
        const next = reserveR2Operation(this.ctx.storage.kv.get(key) || { classA: 0, classB: 0 }, "get");
        if (!next) return { ok: false, code: "R2_BUDGET_EXHAUSTED" };
        this.ctx.storage.kv.put(key, next);
        return { ok: true };
    }
}
