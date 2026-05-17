"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
const crypto_1 = require("crypto");
/**
 * Rate limiter in-memory de tres capas, sliding window.
 *
 * Capas (cualquiera puede disparar 429):
 *
 *   1. Per-token (key = SHA-256 del bearer token)
 *      Default: MCP_RATE_LIMIT_PER_MIN = 60
 *      Defensa contra abuse de un token específico.
 *
 *   2. Per-owner (key = adminUserOwner.id)
 *      Default: MCP_RATE_LIMIT_PER_USER_PER_MIN = 120 (2x per-token)
 *      Defensa contra el caso "1 user crea N tokens para bypass del per-token".
 *      Requiere Strapi 5.45+ (campo adminUserOwner). En versiones anteriores
 *      se skipea silenciosamente.
 *
 *   3. Per-IP (key = ctx.request.ip)
 *      Default: MCP_RATE_LIMIT_PER_IP_PER_MIN = 300 (5x per-token)
 *      Defensa adicional independiente del token. Si el plugin corre detrás de
 *      un proxy/CDN, asegurate de tener `proxy: true` en config/server.ts para
 *      que ctx.request.ip respete X-Forwarded-For.
 *
 * Cache de owner: lookup a DB es caro. Cacheamos token→owner por 5 min in-memory
 * para que solo se haga 1 query por token cada 5 min (vs cada request).
 *
 * Limitaciones:
 *  - In-memory por instancia. Multi-instancia detrás de LB no comparten contadores.
 *    Para defensa completa: rate limit a nivel de proxy/CDN o Redis backend.
 */
const DEFAULT_PER_TOKEN_PER_MIN = 60;
const DEFAULT_PER_USER_PER_MIN = 120;
const DEFAULT_PER_IP_PER_MIN = 300;
const DEFAULT_WINDOW_MS = 60000;
const CLEANUP_INTERVAL_MS = 5 * 60000;
const OWNER_CACHE_TTL_MS = 5 * 60000;
function getWindowMs() {
    var _a;
    const raw = parseInt((_a = process.env.MCP_RATE_LIMIT_WINDOW_MS) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WINDOW_MS;
}
function getPerTokenLimit() {
    var _a;
    const raw = parseInt((_a = process.env.MCP_RATE_LIMIT_PER_MIN) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PER_TOKEN_PER_MIN;
}
function getPerUserLimit() {
    var _a;
    const raw = parseInt((_a = process.env.MCP_RATE_LIMIT_PER_USER_PER_MIN) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PER_USER_PER_MIN;
}
function getPerIpLimit() {
    var _a;
    const raw = parseInt((_a = process.env.MCP_RATE_LIMIT_PER_IP_PER_MIN) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PER_IP_PER_MIN;
}
// ─── Sliding window storage ──────────────────────────────────────────────────
const hits = new Map();
const ownerCache = new Map();
let cleanupTimer = null;
function startCleanupIfNeeded() {
    var _a;
    if (cleanupTimer)
        return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        const cutoff = now - getWindowMs();
        for (const [key, timestamps] of hits.entries()) {
            const fresh = timestamps.filter((t) => t > cutoff);
            if (fresh.length === 0)
                hits.delete(key);
            else if (fresh.length !== timestamps.length)
                hits.set(key, fresh);
        }
        // Cleanup de owner cache
        const ownerCutoff = now - OWNER_CACHE_TTL_MS;
        for (const [key, entry] of ownerCache.entries()) {
            if (entry.cachedAt < ownerCutoff)
                ownerCache.delete(key);
        }
    }, CLEANUP_INTERVAL_MS);
    (_a = cleanupTimer.unref) === null || _a === void 0 ? void 0 : _a.call(cleanupTimer);
}
function hashToken(token) {
    return (0, crypto_1.createHash)("sha256").update(token).digest("hex");
}
/**
 * Chequea un contador genérico. Key arbitraria, limit opcional (default per-token).
 * Si se excede, devuelve allowed:false con info de cuándo reintentar.
 */
function checkRateLimit(key, customLimit) {
    var _a;
    startCleanupIfNeeded();
    const now = Date.now();
    const windowMs = getWindowMs();
    const limit = customLimit !== null && customLimit !== void 0 ? customLimit : getPerTokenLimit();
    const cutoff = now - windowMs;
    const timestamps = ((_a = hits.get(key)) !== null && _a !== void 0 ? _a : []).filter((t) => t > cutoff);
    if (timestamps.length >= limit) {
        const oldestInWindow = timestamps[0];
        const retryAfterMs = oldestInWindow + windowMs - now;
        return {
            allowed: false,
            remaining: 0,
            retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
            limit,
        };
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    return {
        allowed: true,
        remaining: limit - timestamps.length,
        retryAfterSec: 0,
        limit,
    };
}
/**
 * Lookup del adminUserOwner del token, cacheado por OWNER_CACHE_TTL_MS.
 * Devuelve null si el token no tiene owner (Strapi <5.45, token de servicio,
 * o el lookup falla).
 */
async function getOwnerIdForToken(strapi, accessKeyHash) {
    var _a;
    const cached = ownerCache.get(accessKeyHash);
    if (cached && Date.now() - cached.cachedAt < OWNER_CACHE_TTL_MS) {
        return cached.ownerId;
    }
    let ownerId = null;
    try {
        const tokenRow = await strapi.db.query("admin::api-token").findOne({
            where: { accessKey: accessKeyHash },
            populate: { adminUserOwner: true },
        });
        if ((_a = tokenRow === null || tokenRow === void 0 ? void 0 : tokenRow.adminUserOwner) === null || _a === void 0 ? void 0 : _a.id) {
            ownerId = tokenRow.adminUserOwner.id;
        }
    }
    catch {
        // Si la lookup falla (versión vieja sin el campo, error de DB, etc.),
        // tratamos como sin owner. El check per-owner se skipea.
        ownerId = null;
    }
    ownerCache.set(accessKeyHash, { ownerId, cachedAt: Date.now() });
    return ownerId;
}
function normalizeIp(rawIp) {
    if (!rawIp)
        return "unknown";
    // Quitar IPv6 prefix de IPv4-mapped (::ffff:127.0.0.1 → 127.0.0.1)
    return rawIp.replace(/^::ffff:/i, "").toLowerCase();
}
// ─── Strapi v5 middleware factory ────────────────────────────────────────────
exports.default = (_config, { strapi }) => {
    return async (ctx, next) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const authHeader = (_c = (_b = (_a = ctx.request) === null || _a === void 0 ? void 0 : _a.headers) === null || _b === void 0 ? void 0 : _b.authorization) !== null && _c !== void 0 ? _c : (_e = (_d = ctx.request) === null || _d === void 0 ? void 0 : _d.header) === null || _e === void 0 ? void 0 : _e.authorization;
        // Sin auth header, dejamos pasar — la policy de auth va a rechazar con 401.
        // Igual aplicamos el check per-IP para evitar enumeration de tokens.
        let tokenHash = null;
        if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
            const token = authHeader.slice("bearer ".length).trim();
            if (token)
                tokenHash = hashToken(token);
        }
        // ── Capa 1: per-token ────────────────────────────────────────────────────
        if (tokenHash) {
            const tokenCheck = checkRateLimit(`token:${tokenHash}`, getPerTokenLimit());
            ctx.set("X-RateLimit-Limit", String(tokenCheck.limit));
            ctx.set("X-RateLimit-Remaining", String(tokenCheck.remaining));
            if (!tokenCheck.allowed) {
                return reject429(ctx, strapi, "per-token", tokenCheck);
            }
        }
        // ── Capa 2: per-owner (requiere lookup) ──────────────────────────────────
        if (tokenHash) {
            const ownerId = await getOwnerIdForToken(strapi, tokenHash);
            if (ownerId !== null) {
                const ownerCheck = checkRateLimit(`owner:${ownerId}`, getPerUserLimit());
                ctx.set("X-RateLimit-User-Limit", String(ownerCheck.limit));
                ctx.set("X-RateLimit-User-Remaining", String(ownerCheck.remaining));
                if (!ownerCheck.allowed) {
                    return reject429(ctx, strapi, "per-user", ownerCheck);
                }
            }
        }
        // ── Capa 3: per-IP (siempre, incluso sin token) ──────────────────────────
        const ip = normalizeIp((_h = (_g = (_f = ctx.request) === null || _f === void 0 ? void 0 : _f.ip) !== null && _g !== void 0 ? _g : ctx.ip) !== null && _h !== void 0 ? _h : (_k = (_j = ctx.req) === null || _j === void 0 ? void 0 : _j.socket) === null || _k === void 0 ? void 0 : _k.remoteAddress);
        const ipCheck = checkRateLimit(`ip:${ip}`, getPerIpLimit());
        ctx.set("X-RateLimit-IP-Limit", String(ipCheck.limit));
        ctx.set("X-RateLimit-IP-Remaining", String(ipCheck.remaining));
        if (!ipCheck.allowed) {
            return reject429(ctx, strapi, "per-ip", ipCheck);
        }
        await next();
    };
};
function reject429(ctx, strapi, layer, check) {
    ctx.set("Retry-After", String(check.retryAfterSec));
    ctx.status = 429;
    ctx.body = {
        error: {
            status: 429,
            name: "TooManyRequestsError",
            message: `Rate limit exceeded (${layer})`,
            details: {
                layer,
                reason: layerMessage(layer, check.limit, check.retryAfterSec),
                limit: check.limit,
                retry_after_seconds: check.retryAfterSec,
            },
        },
    };
    strapi.log.warn(`[strapi-mcp] Rate limit ${layer} hit (${check.limit}/${getWindowMs() / 1000}s exceeded, retry in ${check.retryAfterSec}s)`);
}
function layerMessage(layer, limit, retryAfterSec) {
    const window = getWindowMs() / 1000;
    switch (layer) {
        case "per-token":
            return `Excediste ${limit} requests/${window}s para este token. Esperá ${retryAfterSec}s. Subí MCP_RATE_LIMIT_PER_MIN si necesitás más throughput.`;
        case "per-user":
            return `Excediste ${limit} requests/${window}s para tu admin user (suma de todos tus tokens). Defensa contra creación masiva de tokens. Subí MCP_RATE_LIMIT_PER_USER_PER_MIN si necesitás más throughput.`;
        case "per-ip":
            return `Excediste ${limit} requests/${window}s desde tu IP (suma de todos los tokens enviados desde ahí). Subí MCP_RATE_LIMIT_PER_IP_PER_MIN si tenés varios devs detrás del mismo NAT.`;
        default:
            return `Rate limit exceeded.`;
    }
}
