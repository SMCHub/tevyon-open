import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Ajv } from "ajv";
import { catalog } from "./catalog";
import { paramSpace, SAMPLE_UPLOAD } from "./param-space";
import { createComfyProvider } from "./providers/comfy";
import type { JobTypeDef } from "./register";

/**
 * Every request we can send matches the schema the Comfy Router enforces before a call reaches the model
 * (docs.comfy.org/router-schemas, copied by scripts/router-schemas.ts). Each offered setting, with and without the
 * optional inputs, goes through the real provider code, so inlining and asset links are part of what is checked.
 */
const DIR = path.join(import.meta.dirname, "data/router-schemas");
// OpenAPI 3.0 keywords (nullable, example, discriminator …) carry no rule here; strict: false lets them pass.
// "byte" is raw base64: a data URL where the model wants bare bytes fails here, as it would at the router.
const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
  .addFormat("byte", /^[A-Za-z0-9+/]*={0,2}$/)
  .addFormat("uri", /^(https?:|data:)\S+$/)
  .addFormat("uint32", { type: "number", validate: (n: number) => Number.isInteger(n) && n >= 0 && n < 2 ** 32 });
/** OpenAPI's `nullable` without a `type` (some Bria fields) allows any value already; ajv refuses it, so it goes. */
const withoutBareNullable = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(withoutBareNullable);
  if (!v || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  return Object.fromEntries(Object.entries(o).filter(([k]) => k !== "nullable" || "type" in o).map(([k, x]) => [k, withoutBareNullable(x)]));
};
const schemas = new Map(
  readdirSync(DIR).map((f) => {
    const doc = JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as { id: string; schema: Record<string, unknown> };
    return [doc.id, ajv.compile(withoutBareNullable(doc.schema) as Record<string, unknown>)] as const;
  }),
);

/** Each setting, plus the same setting with every optional input the model takes. */
function variants(def: JobTypeDef): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const p of paramSpace(def)) {
    out.push(p);
    for (const extra of [{ image: SAMPLE_UPLOAD }, { refs: [SAMPLE_UPLOAD] }, { end_image: SAMPLE_UPLOAD }]) {
      const parsed = def.params.safeParse({ ...p, ...extra });
      if (parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(p)) out.push(parsed.data as Record<string, unknown>);
    }
  }
  return out;
}

/** The router id these params go to (routeFor), as the worker picks it. */
const routeOf = (def: JobTypeDef, params: Record<string, unknown>) => def.routeFor?.(params as never) ?? def.route.providerModel;

/** The body the provider would POST for these params. */
async function body(def: JobTypeDef, params: Record<string, unknown>): Promise<unknown> {
  let sent: unknown;
  const comfy = createComfyProvider({
    apiKey: "k",
    fetch: async (url, init) => {
      if (String(url).endsWith("/api/v2/assets")) return Response.json({ url: "https://storage.test/a.mp4?sig=x" }, { status: 201 });
      sent = JSON.parse(String(init?.body));
      return Response.json({ request_id: "r" }, { status: 201 });
    },
    loadMedia: async (url) => ({ data: new Uint8Array([1, 2, 3]), contentType: url.endsWith(".mp4") ? "video/mp4" : "image/png" }),
  });
  const vendor = def.vendorParams ? def.vendorParams(params as never) : params;
  const res = await comfy.submit({ kind: def.kind, providerModel: routeOf(def, params), params: vendor });
  expect(res.state).toBe("pending");
  return sent;
}

describe("requests match the Comfy Router's schemas", () => {
  it("has a schema for every router model in the register", () => {
    const missing = catalog.list().flatMap((d) => d.routes ?? [d.route.providerModel]).filter((id) => !schemas.has(id));
    expect(missing, "run: node scripts/router-schemas.ts").toEqual([]);
  });

  it("lists every route routeFor can pick, and routeFor picks each of them", () => {
    for (const def of catalog.list().filter((d) => d.routeFor)) {
      const picked = new Set(variants(def).map((p) => routeOf(def, p)));
      expect([...picked].sort(), def.jobType).toEqual([...(def.routes ?? [])].sort());
    }
  });

  for (const def of catalog.list()) {
    it(`${def.jobType} → ${(def.routes ?? [def.route.providerModel]).join(", ")}`, async () => {
      const params = variants(def);
      expect(params.length).toBeGreaterThan(0);
      for (const p of params) {
        const schema = schemas.get(routeOf(def, p));
        if (!schema) continue;
        const sent = await body(def, { ...p, prompt: "A red fox in fresh snow." });
        const ok = schema(sent);
        expect(ok, `${JSON.stringify(p)}\n${ajv.errorsText(schema.errors, { separator: "\n" })}`).toBe(true);
      }
    });
  }
});
