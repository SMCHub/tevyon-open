import { currentAccount, unauthorized } from "@/server/account";
import { motionLibrary } from "@/server/motion-library";

/** GET /api/motion-library: recast presets (driving video, preview, poster, mode, prompt, length) with their tab ranks. */
export async function GET() {
  if (!(await currentAccount())) return unauthorized();
  return Response.json({ presets: motionLibrary() });
}
