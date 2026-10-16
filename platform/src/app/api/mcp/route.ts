import { reuseOutput } from "@/core/reuse";
import { consentUrl, requestConsent } from "@/server/person-consent";
import { webhookSecret } from "@/server/webhook-secret";
import { catalog } from "@/core/catalog";
import { createCredits } from "@/core/credits";
import { community } from "@/server/community";
import { director } from "@/server/director-deps";
import { verifyBearer } from "@/server/keys";
import { createTachyonMcpServer, directorForMcp } from "@/server/mcp";
import { createMcpEndpoint } from "@/server/mcp-http";
import { presetsForMcp } from "@/server/mcp-presets";
import { continueUgc, marketingOverview, startMarketing } from "@/server/marketing";
import { countedNetwork } from "@/server/network-limits";
import { mediaLinks, publicBase } from "@/server/media-links";
import { checkImageUrl, fetchRemoteImage } from "@/server/remote-image";
import { uploadLinks } from "@/server/upload-links";
import { acceptAccountUpload } from "@/server/uploads";
import { listedRegister, publicLifecycle } from "@/server/models";
import { runtime } from "@/server/runtime";

/**
 * get_job and generate wait up to 50 s for a result; ask_director waits for a whole Director turn and stops it after
 * 240 s (a paid message is then refunded), well before the platform would cut the request off.
 */
export const maxDuration = 300;

/** Tachyon's MCP server for agents (claude.ai, Claude Code, Cursor …): Authorization: Bearer with an API key or OAuth token. */
const serve = createMcpEndpoint({
  verify: verifyBearer,
  resourceMetadataUrl: (req) => `${publicBase(req)}/.well-known/oauth-protected-resource/api/mcp`,
  async server(principal, req) {
    const rt = await runtime();
    rt.nudge();
    const links = mediaLinks();
    const base = publicBase(req);
    // Retired models are left out of list_models, get() still knows them for running jobs.
    const availability = rt.models.availability;
    return createTachyonMcpServer({
      register: listedRegister(catalog, availability),
      lifecycle: (jobType) => publicLifecycle(availability(jobType)),
      uploads: {
        uploadUrl(accountId) {
          const links = uploadLinks();
          return { url: `${base}/api/uploads/signed?${links.sign(accountId, crypto.randomUUID())}`, expiresIn: links.ttlSeconds };
        },
        async importImage(accountId, url) {
          const img = await fetchRemoteImage(url);
          if (!img.ok) return img;
          // Scanned like every upload: a blocked image is not stored, a missing scan means no import.
          const res = await acceptAccountUpload(accountId, img.data);
          if (!res.ok) return { ok: false, error: res.error, message: res.error === "upload_blocked" ? "The image breaks the usage rules and was not stored." : res.error === "scan_unavailable" ? "The upload check is unavailable right now, try again shortly." : res.error === "upload_limit" ? "The account's uploads for today are used up (200 per day); try again tomorrow." : "Not a PNG, JPEG or WebP image." };
          return { ok: true, path: res.url, contentType: img.contentType, bytes: img.data.byteLength };
        },
        fromJob: (accountId, jobId, index) =>
          reuseOutput(
            {
              getJob: (a, j) => rt.jobs.get(a, j),
              read: async (url) => (await rt.media.read(url.replace(/^\/api\/media\//, "")))?.data,
              media: rt.media,
            },
            accountId,
            jobId,
            index,
          ),
      },
      jobs: rt.jobs,
      balance: (id) => rt.repo.balance(id),
      statement: (id) => createCredits(rt.repo).statement(id),
      account: { id: principal.accountId, keyId: principal.keyId, dailyLimit: principal.dailyLimit, ...(principal.email ? { email: principal.email } : {}) },
      link: (url) => links.sign(url, base),
      // On Vercel nothing runs between requests: a tool that waits for a job does a worker pass while it waits.
      ...(process.env.VERCEL
        ? { wait: (ms: number) => Promise.race([rt.jobs.tick(), new Promise((r) => setTimeout(r, ms))]).then(() => undefined) }
        : {}),
      director: directorForMcp(async () => (await director()).service, countedNetwork(principal.kind, req.headers)),
      marketing: {
        overview: () => marketingOverview(rt),
        start: (accountId, body, opts) => startMarketing(rt, accountId, body, opts),
        continueUgc: (accountId, body, opts) => continueUgc(rt, accountId, body, opts),
      },
      community: await community(),
      presets: presetsForMcp({
        register: catalog,
        quote: (jobType, params) => {
          const q = rt.jobs.quote(jobType, params);
          return q.ok ? q.credits : null;
        },
      }),
      // Jobs that show real people: the user confirms on /consent/<id> before an agent's job starts (core/consent.ts).
      consent: {
        request: (accountId, jobType, params) => requestConsent(catalog, rt.consent, accountId, jobType, params),
        url: (id) => consentUrl(base, id),
      },
      // Webhooks for finished jobs: public https addresses only, signed with the account's secret (core/webhooks.ts).
      webhooks: {
        check: (url) => {
          if (!webhookSecret(principal.accountId)) return "webhooks are not available";
          const checked = checkImageUrl(url);
          return checked.ok ? null : checked.reason;
        },
        register: (jobId, accountId, url) => rt.webhooks.register(jobId, accountId, url, base),
        secret: webhookSecret,
      },
      // Only the prompt limit of each model's skill goes out; the skills stay on the server.
      promptMax: (jobType) => rt.skills.promptSkillFor(jobType, catalog.get(jobType)?.family).rules?.maxChars,
    });
  },
});

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
