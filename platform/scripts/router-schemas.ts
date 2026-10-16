// Downloads the request schema the Comfy Router enforces for every model in the register into
// src/core/data/router-schemas/ (one JSON file per router id). The contract test checks our requests against them.
// Usage: node scripts/router-schemas.ts   (needs no key; re-run after adding a model)
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runnerImport } from "vite";

const root = path.join(import.meta.dirname, "..");
const { module } = await runnerImport<{ catalog: { list(): { route: { providerModel: string }; routes?: string[] }[] } }>(
  path.join(root, "src/core/catalog.ts"),
  { configFile: false, logLevel: "error", root },
);
const out = path.join(root, "src/core/data/router-schemas");
await mkdir(out, { recursive: true });

// Every route a job type can take: its own, or all its routeFor picks (`routes`).
const ids = [...new Set(module.catalog.list().flatMap((d) => d.routes ?? [d.route.providerModel]))].sort();
for (const id of ids) {
  const res = await fetch(`https://docs.comfy.org/router-schemas/${id}.json`);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const doc = (await res.json()) as {
    info: { version: string };
    paths: Record<string, { post: { requestBody: { content: { "application/json": { schema: unknown } } } } }>;
    components?: { schemas?: Record<string, unknown> };
  };
  const post = Object.values(doc.paths).find((p) => p.post)?.post;
  if (!post) throw new Error(`${id}: no request schema`);
  // A self-contained JSON Schema: the shared components become $defs (only those the request uses, transitively).
  const local = (v: unknown) => JSON.parse(JSON.stringify(v).replaceAll('"#/components/schemas/', '"#/$defs/'));
  const all = doc.components?.schemas ?? {};
  const defs: Record<string, unknown> = {};
  const pending = [post.requestBody.content["application/json"].schema];
  while (pending.length) {
    for (const [, name] of JSON.stringify(pending.pop()).matchAll(/"#\/components\/schemas\/([^"]+)"/g)) {
      if (name && !(name in defs)) { defs[name] = local(all[name]); pending.push(all[name]); }
    }
  }
  const schema = { ...local(post.requestBody.content["application/json"].schema), ...(Object.keys(defs).length ? { $defs: defs } : {}) };
  await writeFile(path.join(out, `${id.replace("/", "__")}.json`), JSON.stringify({ id, version: doc.info.version, schema }, null, 1) + "\n");
  console.log(`${id} ${doc.info.version}`);
}
