import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { MAX_UPLOAD_BYTES, sniffImage, type ImageType } from "@/core/uploads";

/**
 * Fetches a public image for an agent (MCP import_image) without letting anyone reach our internal network (SSRF):
 * https on port 443 only, no credentials in the URL, and every address the name resolves to must be public. The
 * check sits in the socket's own DNS lookup, so a name that re-resolves to 127.0.0.1 between check and connect
 * (DNS rebinding) is refused too. Redirects are followed by hand, at most three, each checked again.
 */
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

function v4Public(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a = 0, b = 0, c = 0] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this network, private, loopback, multicast/reserved
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol assignments, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  return true;
}

/** The eight 16-bit groups of an IPv6 address, or null. Handles "::" and a trailing dotted IPv4 part. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, "");
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4?.[1]) {
    const p = v4[1].split(".").map(Number);
    if (p.length !== 4 || p.some((n) => n > 255)) return null;
    s = s.slice(0, -v4[1].length) + `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

const embeddedV4 = (g: number[], from: number) => `${g[from]! >> 8}.${g[from]! & 255}.${g[from + 1]! >> 8}.${g[from + 1]! & 255}`;

function v6Public(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return false;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Public(embeddedV4(g, 6)); // IPv4-mapped
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Public(embeddedV4(g, 6)); // NAT64
  if (g[0] === 0x2002) return false; // 6to4 carries an IPv4 address of unknown kind
  if ((g[0]! & 0xfe00) === 0xfc00) return false; // unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return false; // link-local
  if ((g[0]! & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return false; // discard
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  return kind === 4 ? v4Public(ip) : kind === 6 ? v6Public(ip) : false;
}

export function checkImageUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "only https addresses are accepted" };
  if (url.username || url.password) return { ok: false, reason: "no credentials in the address" };
  if (url.port && url.port !== "443") return { ok: false, reason: "only the standard https port" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host)) return { ok: false, reason: "not a public address" };
  return { ok: true, url };
}

/** DNS lookup for the socket that refuses names resolving to any non-public address. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(Object.assign(new Error(`${hostname} resolves to a non-public address`), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: typeof addresses) => void)(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

export type RemoteImage =
  | { ok: true; data: Uint8Array; contentType: ImageType }
  | { ok: false; error: "bad_url" | "blocked_address" | "too_many_redirects" | "http_error" | "too_large" | "not_an_image" | "timeout" | "network"; message: string };

function getOnce(url: URL, maxBytes: number, accept = "image/png,image/jpeg,image/webp"): Promise<{ status: number; location?: string; data?: Uint8Array } | { error: "blocked_address" | "too_large" | "timeout" | "network"; message: string }> {
  return new Promise((resolve) => {
    const req = request(url, { method: "GET", lookup: safeLookup, timeout: TIMEOUT_MS, headers: { "user-agent": "TevyonImageImport/1.0", accept } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, ...(res.headers.location ? { location: res.headers.location } : {}) });
      }
      if (status !== 200) {
        res.resume();
        return resolve({ status });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          return resolve({ error: "too_large", message: `larger than ${Math.round(maxBytes / 1024 / 1024)} MB` });
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, data: new Uint8Array(Buffer.concat(chunks)) }));
      res.on("error", (e) => resolve({ error: "network", message: e.message }));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "timeout", message: "the server took too long" });
    });
    req.on("error", (e: NodeJS.ErrnoException) => resolve(e.code === "EBLOCKED" ? { error: "blocked_address", message: e.message } : { error: "network", message: e.message }));
    req.end();
  });
}

export async function fetchRemoteImage(raw: string, opts: { maxBytes?: number } = {}): Promise<RemoteImage> {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkImageUrl(current);
    if (!checked.ok) return { ok: false, error: "bad_url", message: checked.reason };
    const res = await getOnce(checked.url, maxBytes);
    if ("error" in res) return { ok: false, error: res.error, message: res.message };
    if (res.location !== undefined) {
      current = new URL(res.location, checked.url).toString();
      continue;
    }
    if (res.status !== 200 || !res.data) return { ok: false, error: "http_error", message: `the server answered ${res.status}` };
    const type = sniffImage(res.data);
    if (!type) return { ok: false, error: "not_an_image", message: "only PNG, JPEG or WebP images" };
    return { ok: true, data: res.data, contentType: type };
  }
  return { ok: false, error: "too_many_redirects", message: `more than ${MAX_REDIRECTS} redirects` };
}

const MAX_PAGE_BYTES = 3 * 1024 * 1024;

export type RemotePage = { ok: true; html: string; url: string } | { ok: false; error: Exclude<Extract<RemoteImage, { ok: false }>["error"], "not_an_image">; message: string };

/**
 * Fetches a public HTML page (Marketing Agent "product link") with the same SSRF rules as images: https only,
 * public addresses checked in the socket lookup, at most three redirects, at most 3 MB. Returns the final URL so
 * relative image paths resolve against it.
 */
export async function fetchRemotePage(raw: string): Promise<RemotePage> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkImageUrl(current);
    if (!checked.ok) return { ok: false, error: "bad_url", message: checked.reason };
    const res = await getOnce(checked.url, MAX_PAGE_BYTES, "text/html,application/xhtml+xml");
    if ("error" in res) return { ok: false, error: res.error, message: res.message };
    if (res.location !== undefined) {
      current = new URL(res.location, checked.url).toString();
      continue;
    }
    if (res.status !== 200 || !res.data) return { ok: false, error: "http_error", message: `the server answered ${res.status}` };
    return { ok: true, html: new TextDecoder().decode(res.data), url: checked.url.toString() };
  }
  return { ok: false, error: "too_many_redirects", message: `more than ${MAX_REDIRECTS} redirects` };
}

/**
 * Posts a body to a public https address (job webhooks, core/webhooks.ts) under the same SSRF rules as the image
 * import: https on port 443, no credentials, every address the name resolves to public, checked in the socket's own
 * lookup. Redirects are not followed: a webhook answers where it was set up. ok for a 2xx answer.
 */
export function postPublic(raw: string, body: string, headers: Record<string, string>): Promise<{ ok: boolean; status?: number; error?: string }> {
  const checked = checkImageUrl(raw);
  if (!checked.ok) return Promise.resolve({ ok: false, error: checked.reason });
  return new Promise((resolve) => {
    const req = request(
      checked.url,
      { method: "POST", lookup: safeLookup, timeout: TIMEOUT_MS, headers: { ...headers, "content-length": String(Buffer.byteLength(body)) } },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.end(body);
  });
}
