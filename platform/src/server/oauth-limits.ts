import type { RateLimiter, RateRule } from "../core/rate-limit";

/**
 * How often the open OAuth endpoints may be called: per address, and by everyone together. Registration creates a
 * stored client, a device login a stored code; without limits a script could fill the database. Generous enough for
 * people: Claude registers once per installation, `tevyon login` starts one device login per try.
 */
export const OAUTH_LIMITS: Record<"register" | "device", { perAddress: RateRule; total: RateRule }> = {
  register: { perAddress: { limit: 10, windowMs: 3_600_000 }, total: { limit: 500, windowMs: 3_600_000 } },
  device: { perAddress: { limit: 20, windowMs: 600_000 }, total: { limit: 1000, windowMs: 3_600_000 } },
};

/** The first four groups of an IPv6 address (its /64), or null if it does not parse. */
function prefix64(address: string): string | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * The caller's address as the platform saw it: x-real-ip (set by Vercel, not by the client), else the first entry of
 * x-forwarded-for. IPv6 counts per /64, because one machine gets a whole /64 and could rotate through it.
 */
export function clientAddress(headers: Pick<Headers, "get">): string {
  let raw = (headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  // A port some proxies append: "203.0.113.7:51234", "[2001:db8::7]:443".
  raw = raw.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1").replace(/^\[([^\]]+)\](?::\d+)?$/, "$1").replace(/%.*$/, "");
  if (!raw) return "unknown";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1]!;
  if (!raw.includes(":")) return raw;
  return prefix64(raw) ?? raw.toLowerCase();
}

/** Counts a call to an open OAuth endpoint; null when it may go on, else how long to wait. */
export function createOAuthLimits(limiter: RateLimiter) {
  return async (req: Request, endpoint: keyof typeof OAUTH_LIMITS): Promise<{ retryAfterSeconds: number } | null> => {
    const rule = OAUTH_LIMITS[endpoint];
    const own = await limiter.hit(`oauth.${endpoint}:addr:${clientAddress(req.headers)}`, rule.perAddress);
    if (!own.ok) return { retryAfterSeconds: own.retryAfterSeconds };
    const all = await limiter.hit(`oauth.${endpoint}:all`, rule.total);
    return all.ok ? null : { retryAfterSeconds: all.retryAfterSeconds };
  };
}
