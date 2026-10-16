import type { Provider, ProviderRequest, ProviderResult } from "@/core/provider";

/**
 * Development stand-in used while no provider key is configured. Produces a labelled
 * placeholder after a short wait so the whole job flow can be clicked through for free.
 */
export function createDemoProvider(): Provider {
  const pending = new Map<string, { req: ProviderRequest; polls: number }>();

  function placeholder(req: ProviderRequest): ProviderResult {
    const hue = [...String(req.params.prompt ?? "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><radialGradient id="g" cx="30%" cy="25%" r="90%"><stop offset="0" stop-color="hsl(${hue} 30% 70%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 25% 12%)"/></radialGradient></defs>
<rect width="1024" height="1024" fill="url(#g)"/>
<text x="48" y="980" font-family="sans-serif" font-size="28" fill="rgba(255,255,255,.7)">DEMO · ${req.kind}</text></svg>`;
    return { state: "completed", outputs: [{ contentType: "image/svg+xml", data: new TextEncoder().encode(svg) }] };
  }

  return {
    async submit(req) {
      const handle = `demo_${crypto.randomUUID()}`;
      pending.set(handle, { req, polls: 0 });
      return { state: "pending", handle };
    },
    async poll(handle) {
      const p = pending.get(handle);
      if (!p) return { state: "failed", reason: "provider_error" };
      p.polls++;
      const needed = p.req.kind === "video" ? 4 : 1;
      if (p.polls < needed) return { state: "pending", handle };
      pending.delete(handle);
      return placeholder(p.req);
    },
  };
}
