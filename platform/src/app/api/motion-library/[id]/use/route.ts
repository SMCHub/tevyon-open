import { readFile } from "node:fs/promises";
import path from "node:path";
import { recreateFromLibrary } from "@/core/motion-library";
import { currentAccount, unauthorized } from "@/server/account";
import { motionLibrary } from "@/server/motion-library";
import { runtime } from "@/server/runtime";

const PUBLIC = path.join(process.cwd(), "public");

/** A template file: our media store (/api/media/…) or a clip that ships in public/ (/presets/…, /marketing/…). */
async function readTemplateFile(url: string, rt: Awaited<ReturnType<typeof runtime>>): Promise<Uint8Array | undefined> {
  if (url.startsWith("/api/media/")) return (await rt.media.read(url.replace(/^\/api\/media\//, "")))?.data;
  const file = path.resolve(PUBLIC, `.${url}`);
  if (!file.startsWith(PUBLIC + path.sep)) return undefined;
  return readFile(file).then((b) => new Uint8Array(b), () => undefined);
}

/** POST /api/motion-library/{id}/use: the template's driving video as your upload, plus its mode and prompt ("Recreate"). */
export async function POST(_req: Request, ctx: RouteContext<"/api/motion-library/[id]/use">) {
  const account = await currentAccount();
  if (!account) return unauthorized();
  const { id } = await ctx.params;
  const rt = await runtime();
  const res = await recreateFromLibrary({ presets: motionLibrary(), read: (url) => readTemplateFile(url, rt), media: rt.media }, account.id, id);
  return Response.json(res, { status: res.ok ? 201 : 404 });
}
