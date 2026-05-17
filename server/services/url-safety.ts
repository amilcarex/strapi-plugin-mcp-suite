import * as dns from "dns/promises";
import * as net from "net";

/**
 * Defensa contra SSRF (Server-Side Request Forgery).
 *
 * Antes de que el plugin haga fetch() a una URL que vino del LLM, validamos:
 *   1. Protocolo: solo http/https.
 *   2. Hostname no es una IP literal de un rango sensible (loopback, link-local,
 *      RFC1918, IANA reserved, etc.).
 *   3. Hostname resuelve por DNS a IPs que tampoco están en rangos sensibles.
 *      Esto bloquea el bypass via DNS rebinding básico y nombres dinámicos.
 *   4. Redirects: el caller debe usar `redirect: 'manual'` y re-validar cada hop
 *      con esta misma función. Helper `fetchWithSafeRedirects` hace exactamente eso.
 *
 * Bloqueamos especialmente:
 *   - 169.254.169.254 (AWS IMDS, Azure metadata)
 *   - 100.100.100.200, 100.100.100.1 (Alibaba metadata)
 *   - 127.0.0.0/8, ::1 (loopback)
 *   - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC1918 / VPC)
 *   - 169.254.0.0/16 (link-local IPv4)
 *   - fc00::/7, fe80::/10 (ULA + link-local IPv6)
 *   - 0.0.0.0/8 (unspecified)
 *   - 224.0.0.0/4 (multicast)
 *
 * Limitations conocidas:
 *   - DNS rebinding sofisticado (TTL=0 + reply-attack) requeriría lookup-and-bind
 *     a la misma IP — no implementado. Aceptable para v1 (raro en práctica).
 *   - Si Node se ejecuta con resolver custom que devuelve IPs falsas, falla.
 */

type IpVersion = 4 | 6;

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return -1;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt < 0 || baseInt < 0) return false;
  const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const IPV4_BLOCKED_CIDRS = [
  "0.0.0.0/8",        // unspecified / "this host"
  "10.0.0.0/8",       // RFC1918
  "100.64.0.0/10",    // CGNAT
  "127.0.0.0/8",      // loopback
  "169.254.0.0/16",   // link-local (incluye 169.254.169.254 IMDS)
  "172.16.0.0/12",    // RFC1918
  "192.0.0.0/24",     // IETF assignments
  "192.0.2.0/24",     // TEST-NET-1
  "192.168.0.0/16",   // RFC1918
  "198.18.0.0/15",    // benchmarking
  "198.51.100.0/24",  // TEST-NET-2
  "203.0.113.0/24",   // TEST-NET-3
  "224.0.0.0/4",      // multicast
  "240.0.0.0/4",      // reserved
];

const IPV4_EXTRA_BLOCKED_IPS = new Set([
  "100.100.100.200", // Alibaba Cloud metadata
  "100.100.100.1",
]);

function isIpv4Blocked(ip: string): boolean {
  if (IPV4_EXTRA_BLOCKED_IPS.has(ip)) return true;
  return IPV4_BLOCKED_CIDRS.some((cidr) => ipv4InCidr(ip, cidr));
}

function isIpv6Blocked(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback
  if (lower === "::1") return true;
  // Unspecified
  if (lower === "::") return true;
  // Link-local fe80::/10
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // ULA fc00::/7
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // Multicast ff00::/8
  if (lower.startsWith("ff")) return true;
  // IPv4-mapped: ::ffff:0:0/96 — validar el IPv4 contenido
  const mappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) return isIpv4Blocked(mappedMatch[1]);
  // IPv4-mapped en formato hex: ::ffff:c0a8:0001 (= ::ffff:192.168.0.1)
  // Detección naïve: bloquear cualquier dirección con prefijo ::ffff:
  if (lower.startsWith("::ffff:")) return true;
  return false;
}

// ─── User-configurable allow/block lists (env vars) ──────────────────────────
//
// El dev puede extender la defensa SSRF via env vars en .env:
//
//   UPLOAD_URL_EXTRA_BLOCKED_HOSTS   — hosts/IPs adicionales (comma-separated)
//   UPLOAD_URL_EXTRA_BLOCKED_CIDRS   — CIDRs IPv4 adicionales (comma-separated)
//   UPLOAD_URL_ALLOWED_HOSTS         — si está, SOLO se permiten estos hosts
//   UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES — sufijos permitidos (ej: .amazonaws.com)
//
// Cuando hay allowlist seteada, el modo cambia a strict: TODO lo no autorizado
// se rechaza, incluso si pasaría la blocklist. Esto es lo más seguro.
//
// Si solo hay extra_blocked, se suman a la blocklist hardcoded.

function parseCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

function getExtraBlockedHosts(): Set<string> {
  return new Set(parseCsvEnv("UPLOAD_URL_EXTRA_BLOCKED_HOSTS").map((h) => h.toLowerCase()));
}

function getExtraBlockedCidrs(): string[] {
  return parseCsvEnv("UPLOAD_URL_EXTRA_BLOCKED_CIDRS");
}

function getAllowedHosts(): Set<string> {
  return new Set(parseCsvEnv("UPLOAD_URL_ALLOWED_HOSTS").map((h) => h.toLowerCase()));
}

function getAllowedDomainSuffixes(): string[] {
  return parseCsvEnv("UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES")
    .map((s) => s.toLowerCase())
    .map((s) => (s.startsWith(".") ? s : "." + s));
}

function isAllowlistActive(): boolean {
  return getAllowedHosts().size > 0 || getAllowedDomainSuffixes().length > 0;
}

function hostMatchesAllowlist(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (getAllowedHosts().has(lower)) return true;
  return getAllowedDomainSuffixes().some((suffix) => lower.endsWith(suffix));
}

function isExtraBlockedHost(hostname: string): boolean {
  return getExtraBlockedHosts().has(hostname.toLowerCase());
}

function isExtraBlockedIp(ip: string): boolean {
  const cidrs = getExtraBlockedCidrs();
  return cidrs.some((cidr) => {
    if (cidr.includes("/")) {
      return ipv4InCidr(ip, cidr);
    }
    return ip === cidr; // single IP literal
  });
}

// ──────────────────────────────────────────────────────────────────────────────

export type UrlSafetyResult =
  | { safe: true; finalUrl: URL; resolvedIps: string[] }
  | { safe: false; reason: string };

export async function validateUrlSafety(rawUrl: string): Promise<UrlSafetyResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: `URL inválida: "${rawUrl}".` };
  }

  if (!/^https?:$/.test(url.protocol)) {
    return {
      safe: false,
      reason: `Protocolo no permitido: "${url.protocol}". Solo http: y https: están permitidos. Bloqueados explícitamente: file:, gopher:, ftp:, data:, javascript:.`,
    };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // quitar brackets de IPv6 si los hay

  // ── Capa 3: Allowlist (si está activa, REEMPLAZA toda otra lógica) ─────────
  if (isAllowlistActive()) {
    if (!hostMatchesAllowlist(hostname)) {
      return {
        safe: false,
        reason: `Allowlist activa: "${hostname}" no está en UPLOAD_URL_ALLOWED_HOSTS ni matchea UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES. Para permitirlo, agregalo a las env vars.`,
      };
    }
    // Pasa la allowlist — igual seguimos validando IPs por safety paranoid.
  }

  // ── Capa 2a: Extra blocked hosts (custom del usuario) ─────────────────────
  if (isExtraBlockedHost(hostname)) {
    return {
      safe: false,
      reason: `Host "${hostname}" está en UPLOAD_URL_EXTRA_BLOCKED_HOSTS (configurado por el dev del proyecto).`,
    };
  }

  // Caso 1: hostname es una IP literal
  const ipVersion: IpVersion | 0 = net.isIP(hostname) as 0 | IpVersion;
  if (ipVersion === 4) {
    if (isIpv4Blocked(hostname)) {
      return { safe: false, reason: `IP "${hostname}" está en un rango bloqueado (loopback / privada / link-local / metadata).` };
    }
    if (isExtraBlockedIp(hostname)) {
      return { safe: false, reason: `IP "${hostname}" está en UPLOAD_URL_EXTRA_BLOCKED_CIDRS (configurado por el dev).` };
    }
    return { safe: true, finalUrl: url, resolvedIps: [hostname] };
  }
  if (ipVersion === 6) {
    if (isIpv6Blocked(hostname)) {
      return { safe: false, reason: `IPv6 "${hostname}" está en un rango bloqueado.` };
    }
    return { safe: true, finalUrl: url, resolvedIps: [hostname] };
  }

  // Caso 2: hostname es un nombre — resolver DNS y validar TODAS las IPs.
  // Si alguna IP devuelta cae en un rango bloqueado, refusamos. Evita
  // que un atacante use un dominio que apunta a 127.0.0.1 (rebinding básico).
  let addresses: Array<{ address: string; family: number }> = [];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err: any) {
    return { safe: false, reason: `No pude resolver DNS de "${hostname}": ${err?.message ?? String(err)}` };
  }

  if (addresses.length === 0) {
    return { safe: false, reason: `DNS no devolvió ninguna IP para "${hostname}".` };
  }

  const blockedIps: string[] = [];
  const extraBlockedIps: string[] = [];
  const goodIps: string[] = [];
  for (const addr of addresses) {
    const isBlocked = addr.family === 4 ? isIpv4Blocked(addr.address) : isIpv6Blocked(addr.address);
    if (isBlocked) {
      blockedIps.push(addr.address);
    } else if (addr.family === 4 && isExtraBlockedIp(addr.address)) {
      extraBlockedIps.push(addr.address);
    } else {
      goodIps.push(addr.address);
    }
  }

  if (extraBlockedIps.length > 0) {
    return {
      safe: false,
      reason: `Hostname "${hostname}" resuelve a IPs en UPLOAD_URL_EXTRA_BLOCKED_CIDRS: [${extraBlockedIps.join(", ")}].`,
    };
  }

  if (blockedIps.length > 0) {
    return {
      safe: false,
      reason: `Hostname "${hostname}" resuelve a IPs bloqueadas: [${blockedIps.join(", ")}]. Posible intento de SSRF vía DNS.`,
    };
  }

  return { safe: true, finalUrl: url, resolvedIps: goodIps };
}

const MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * fetch wrapper que valida cada URL antes del request y NO sigue redirects
 * automáticamente — si hay redirect, valida la URL destino con la misma lógica
 * antes de seguir. Máximo MAX_REDIRECTS hops para evitar loops.
 */
export async function fetchWithSafeRedirects(
  initialUrl: string,
  opts: { timeoutMs: number }
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await validateUrlSafety(currentUrl);
    if (check.safe === false) {
      // discriminated union: explícito === false para que TS haga narrowing
      // bajo "strict: false" del tsconfig del plugin.
      throw new Error(`URL_BLOCKED: ${check.reason}`);
    }
    if (check.safe !== true) {
      // unreachable — defensa por si el tipo se rompe
      throw new Error("URL_BLOCKED: unknown safety result");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(check.finalUrl, {
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === "AbortError") {
        throw new Error(`Timeout descargando "${currentUrl}" después de ${opts.timeoutMs / 1000}s.`);
      }
      throw new Error(`Error descargando "${currentUrl}": ${err?.message ?? String(err)}`);
    }
    clearTimeout(timer);

    if (REDIRECT_STATUS.has(res.status)) {
      const location = res.headers.get("location");
      if (!location) {
        throw new Error(`Redirect ${res.status} sin header Location.`);
      }
      // Resolver relative redirects contra la URL actual
      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = nextUrl;
      // siguiente iteración valida el hop nuevo
      continue;
    }

    return res;
  }

  throw new Error(`Demasiados redirects (>${MAX_REDIRECTS}). Posible loop o intento de bypass.`);
}
