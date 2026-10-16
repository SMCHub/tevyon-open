import { catalog } from "@/core/catalog";
import { publicCatalog } from "@/server/models";
import { runtime } from "@/server/runtime";

/**
 * Public catalog: job types, model names, parameter schemas and lifecycle (status active | deprecated | paused,
 * retiresAt, successor). Retired models are left out. No routes, no vendor IDs. The prompt's maxLength is its skill's.
 */
export async function GET() {
  const rt = await runtime();
  const promptMax = (d: { jobType: string; family?: string }) => rt.skills.promptSkillFor(d.jobType, d.family).rules?.maxChars;
  return Response.json({ jobTypes: publicCatalog(catalog, rt.models.availability, promptMax) });
}
