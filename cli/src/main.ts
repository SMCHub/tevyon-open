import path from "node:path";
import { ApiError, createApi, type Api, type FetchFn, type Job, type Model } from "./api.ts";
import { parseArgs } from "./args.ts";
import { day, outputName, shortId, table, truncate, when } from "./format.ts";
import { messages, pickLang, type Messages } from "./i18n.ts";
import { booleanFlags, buildParams, paramFlags, resolveModel, UPLOAD_PATH, uploadParams } from "./params.ts";
import type { KeyStore } from "./store.ts";

export const VERSION = "0.1.0";
/** Until Tevyon is deployed, the CLI talks to the local platform. TEVYON_URL (old: TACHYON_URL) or --url point elsewhere. */
export const DEFAULT_URL = "http://localhost:3100";
const KEY_PATTERN = /^tch_[0-9A-Za-z]{40}$/;
const POLL_MS = 2000;
const DEFAULT_TIMEOUT_S = 1200;

type Writer = { write(s: string): unknown; isTTY?: boolean };

/** Everything the CLI touches outside itself, so tests can run it without network, keychain or disk. */
export type Io = {
  argv: string[];
  env: Record<string, string | undefined>;
  fetch: FetchFn;
  stdout: Writer;
  stderr: Writer;
  stdinIsTTY: boolean;
  readStdin(): Promise<string>;
  ask(question: string, opts?: { hidden?: boolean }): Promise<string>;
  store: KeyStore;
  /** Opens a URL in the user's browser (best effort). */
  openUrl(url: string): Promise<void>;
  /** This computer's name, to label the CLI's key in Tevyon Studio. */
  hostname(): string;
  writeFile(file: string, data: Uint8Array): Promise<void>;
  readFile(file: string): Promise<Uint8Array>;
  cwd: string;
  sleep(ms: number): Promise<void>;
  now(): number;
  uuid(): string;
};

/** A failure with a message for people and a code for --json. Exit code 2 for wrong usage, 1 for everything else. */
class CliError extends Error {
  readonly code: string;
  readonly exit: number;
  constructor(code: string, message: string, exit = 1) {
    super(message);
    this.code = code;
    this.exit = exit;
  }
}

const COMMANDS = ["login", "logout", "whoami", "credits", "models", "price", "generate", "jobs", "job", "download", "upload", "mcp", "help", "version"];
const ALIASES: Record<string, string> = { gen: "generate", g: "generate", quote: "price", status: "job" };

/** CLI flags per command: booleans stand alone, the rest take a value. Model parameters come on top for price/generate. */
const OWN: Record<string, { booleans: string[]; values: string[] }> = {
  login: { booleans: ["with-key"], values: ["key"] },
  credits: { booleans: ["csv"], values: ["limit"] },
  models: { booleans: [], values: ["kind"] },
  price: { booleans: [], values: ["prompt"] },
  generate: { booleans: ["yes", "wait", "exact"], values: ["prompt", "out", "timeout", "based-on", "consent-id"] },
  jobs: { booleans: [], values: ["limit", "status"] },
  job: { booleans: ["wait", "download"], values: ["out", "timeout"] },
  download: { booleans: ["wait"], values: ["out", "timeout"] },
};
const GLOBAL = { booleans: ["json", "help", "version"], values: ["url"] };

export async function main(io: Io): Promise<number> {
  const t = messages(pickLang(io.env));
  const json = io.argv.includes("--json");
  try {
    return await run(io, t, json);
  } catch (e) {
    const err = e instanceof CliError ? e : e instanceof ApiError ? fromApi(e, t, io) : new CliError("internal", String(e instanceof Error ? e.message : e));
    if (json) io.stdout.write(`${JSON.stringify({ ok: false, error: err.code, message: err.message })}\n`);
    else io.stderr.write(`${err.message}\n`);
    return err.exit;
  }
}

/** A setting from the environment under the current name, else under the name from before the rename (TACHYON_*). */
function envOf(io: Io, name: "URL" | "API_KEY"): string | undefined {
  return io.env[`TEVYON_${name}`] || io.env[`TACHYON_${name}`] || undefined;
}

function baseUrl(io: Io, url: string | boolean | undefined): string {
  const raw = typeof url === "string" ? url : envOf(io, "URL") || DEFAULT_URL;
  try {
    return new URL(raw).origin;
  } catch {
    throw new CliError("bad_url", `--url: ${raw}`, 2);
  }
}

function fromApi(e: ApiError, t: Messages, io: Io): CliError {
  const body = e.body ?? {};
  if (e.code === "network") return new CliError("network", t.network(baseUrl(io, undefined)));
  if (e.status === 401) return new CliError("unauthorized", t.keyInvalid);
  if (e.code === "invalid_params") return new CliError("invalid_params", t.invalidParams(((body.issues as string[]) ?? []).join("; ")), 2);
  if (e.code === "model_retired") return new CliError("model_retired", t.retired(String(body.model ?? ""), typeof body.successor === "string" ? body.successor : undefined));
  if (e.code === "model_paused") return new CliError("model_paused", t.paused(String(body.model ?? "")));
  if (e.code === "price_changed") return new CliError("price_changed", t.priceChanged(Number(body.credits ?? 0)));
  if (e.code === "insufficient_credits") return new CliError("insufficient_credits", t.notEnough(Number(body.credits ?? 0), Number(body.balance ?? 0)));
  if (e.code === "unknown_job_type") return new CliError("unknown_job_type", t.unknownModel(String(body.jobType ?? "")), 2);
  if (e.code === "key_limit_reached") return new CliError("key_limit_reached", t.keyLimit(Number(body.used ?? 0), Number(body.limit ?? 0)));
  if (e.code === "too_many_requests") return new CliError("too_many_requests", t.tooMany(Math.max(1, Math.ceil(Number(body.retry_after ?? 60) / 60))));
  return new CliError(e.code, t.serverError(e.status));
}

async function run(io: Io, t: Messages, json: boolean): Promise<number> {
  // The command is the first word that is not a global flag or the value of --url.
  let index = 0;
  while (index < io.argv.length && (io.argv[index] ?? "").startsWith("-")) index += io.argv[index] === "--url" ? 2 : 1;
  const typed = io.argv[index];
  const command = typed ? (ALIASES[typed] ?? typed) : "help";
  const rest = [...io.argv.slice(0, index), ...io.argv.slice(index + 1)];

  if (!COMMANDS.includes(command)) throw new CliError("unknown_command", t.unknownCommand(typed ?? ""), 2);
  const own = OWN[command] ?? { booleans: [], values: [] };

  // price and generate take model parameters as flags; the catalog says which of them are booleans.
  const base = baseUrl(io, rest.includes("--url") ? rest[rest.indexOf("--url") + 1] : undefined);
  const publicApi = createApi({ base, fetch: io.fetch });
  const models = command === "price" || command === "generate" ? await publicApi.catalog() : [];
  const modelBooleans = booleanFlags(models);
  const known = new Set([...GLOBAL.booleans, ...GLOBAL.values, ...own.booleans, ...own.values]);
  const parsed = parseArgs(rest, (name) => [...GLOBAL.booleans, ...own.booleans].includes(name) || modelBooleans.has(name));
  if ("error" in parsed) throw new CliError("missing_value", t.missingValue(parsed.name), 2);
  const { positionals, flags } = parsed;
  const str = (name: string) => (typeof flags.get(name) === "string" ? (flags.get(name) as string) : undefined);

  if (flags.get("version")) return print(io, json, { version: VERSION }, VERSION);
  if (flags.get("help") || command === "help") return print(io, json, { help: t.help }, t.help);
  if (command === "version") return print(io, json, { version: VERSION }, VERSION);

  const extra = [...flags.keys()].filter((f) => !known.has(f));
  if (extra.length && command !== "price" && command !== "generate") throw new CliError("unknown_option", t.unknownCommand(`--${extra[0]}`), 2);

  const key = envOf(io, "API_KEY") || (await io.store.get(base));
  const api = createApi({ base, fetch: io.fetch, ...(key ? { key } : {}) });
  const needKey = () => {
    if (!key) throw new CliError("not_logged_in", t.notLoggedIn);
    return api;
  };
  const info = (text: string) => {
    if (!json) io.stderr.write(`${text}\n`);
  };

  switch (command) {
    case "login": {
      let given = str("key");
      if (!given && flags.get("with-key") !== true) given = await deviceLogin(io, t, publicApi, info);
      if (!given) given = io.stdinIsTTY ? await io.ask(t.askKey, { hidden: true }) : await io.readStdin();
      given = given.trim();
      if (!KEY_PATTERN.test(given)) throw new CliError("bad_key", t.keyFormat, 2);
      const me = await createApi({ base, key: given, fetch: io.fetch }).me();
      await io.store.set(base, given);
      if (envOf(io, "API_KEY")) info(t.envKeyNote);
      const where = io.store.where === "keychain" ? t.whereKeychain : t.whereFile(io.store.path ?? "");
      return print(io, json, { ok: true, email: me.email, credits: me.credits, stored: io.store.where }, t.loggedIn(me.email ?? "?", me.credits, where));
    }

    case "logout": {
      const removed = await io.store.delete(base);
      return print(io, json, { ok: true, removed }, removed ? t.loggedOut : t.notStored);
    }

    case "whoami": {
      const me = await needKey().me();
      return print(io, json, me, t.whoami(me.email ?? "?", me.credits, Boolean(me.demo)));
    }

    case "upload": {
      if (!positionals[0]) throw new CliError("missing_file", t.fileNotFound(""), 2);
      const url = await uploadFile(io, t, needKey(), positionals[0]);
      return print(io, json, { url }, url);
    }

    case "credits": {
      if (flags.get("csv") === true) {
        io.stdout.write(await needKey().creditsCsv());
        return 0;
      }
      const limit = Math.max(1, Math.min(500, Number(str("limit") ?? 20) || 20));
      const { summary, entries, expiring } = await needKey().credits(limit);
      const lang = pickLang(io.env);
      const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
      const movement = (e: (typeof entries)[number]) => {
        if (e.kind === "grant") return t.grant[e.source ?? ""] ?? e.source ?? "";
        if (e.kind === "reversal") return t.reversal[e.source ?? ""] ?? e.source ?? "";
        if (e.kind === "expiry") return t.expiry;
        const charge = t.charge[e.state ?? ""] ?? e.state ?? "";
        return e.kind === "director" ? `Director · ${e.model ?? ""} · ${charge}` : `${e.model ?? ""} · ${charge}`;
      };
      const rows = entries.map((e) => [
        when(e.at, lang),
        movement(e),
        e.kind === "job" ? (t.origin[e.origin ?? ""] ?? e.origin ?? "–") : "–",
        signed(e.credits),
        String(e.balance),
      ]);
      const head = [t.creditsSummary(summary), ...(expiring ? [t.expiring(expiring.credits, day(expiring.at, lang))] : [])];
      return print(io, json, { summary, entries, expiring: expiring ?? null }, [...head, "", rows.length ? table(t.creditsHead, rows) : t.noEntries].join("\n"));
    }

    case "models": {
      const kind = str("kind");
      const [catalog, prices] = await Promise.all([publicApi.catalog(), publicApi.prices().catch(() => [])]);
      const byType = new Map(prices.map((p) => [p.jobType, p]));
      const rows = catalog.filter((m) => !kind || m.kind === kind)
        .map((m) => ({ ...m, priceFrom: byType.get(m.jobType)?.from ?? null, priceStandard: byType.get(m.jobType)?.standard ?? null }));
      const name = (m: (typeof rows)[number]) => (m.status === "deprecated" ? `${m.model} (${t.runsOut})` : m.status === "paused" ? `${m.model} (${t.pausedTag})` : m.model);
      return print(
        io, json, { models: rows },
        table(t.modelsHead, rows.map((m) => [m.jobType, name(m), t.kind[m.kind] ?? m.kind, t.credits(m.priceFrom), truncate(m.tagline, 60)])),
      );
    }

    case "price": {
      const model = pickModel(models, positionals[0], t);
      const prompt = str("prompt") ?? (positionals.slice(1).join(" ") || undefined);
      const params = toParams(model, flags, known, prompt ?? "x", t);
      // A local start image is not uploaded just for a price: a placeholder path prices the job the same way.
      for (const name of uploadParams(model)) {
        if (typeof params[name] === "string" && !UPLOAD_PATH.test(params[name] as string)) params[name] = PRICE_PLACEHOLDER;
      }
      const q = await publicApi.quote(model.jobType, params);
      const balance = key ? (await api.me()).credits : undefined;
      const notes = prompt ? (q.prompt?.notes ?? []) : [];
      const lines = [t.price(model.model, q.credits), ...(balance === undefined ? [] : [t.balance(balance)])];
      if (notes.length) lines.push(t.notes, ...notes.map((n) => `  · ${n.message}`));
      return print(io, json, { job_type: model.jobType, model: model.model, credits: q.credits, balance: balance ?? null, notes }, lines.join("\n"));
    }

    case "generate": {
      needKey();
      if (!positionals[0]) throw new CliError("missing_model", t.missingModel, 2);
      const model = pickModel(models, positionals[0], t);
      const prompt = str("prompt") ?? (positionals.slice(1).join(" ") || undefined);
      // A swap needs no prompt (its wish is optional); every other model does.
      if (!prompt && (model.params.required ?? []).includes("prompt")) throw new CliError("missing_prompt", t.missingPrompt, 2);
      const params = toParams(model, flags, known, prompt ?? "", t);
      // Local start images go into the account's uploads first; the job then names them by their Tevyon path.
      for (const name of uploadParams(model)) {
        const value = params[name];
        if (typeof value === "string" && !UPLOAD_PATH.test(value)) params[name] = await uploadFile(io, t, api, value);
      }

      const q = await api.quote(model.jobType, params);
      const { credits: balance } = await api.me();
      info(`${t.price(model.model, q.credits)} · ${t.balance(balance)}`);
      for (const n of q.prompt?.notes ?? []) info(`  · ${n.message}`);
      if (balance < q.credits) throw new CliError("insufficient_credits", t.notEnough(q.credits, balance));
      if (flags.get("yes") !== true) {
        if (!io.stdinIsTTY || json) throw new CliError("confirmation_required", t.needsYes(q.credits), 2);
        if (!t.yes.test((await io.ask(t.confirm(q.credits))).trim())) {
          info(t.cancelled);
          return 1;
        }
      }

      // One idempotency key per command: a retry after a network error can never start or charge twice.
      const idempotencyKey = io.uuid();
      const basedOn = str("based-on");
      const consentId = str("consent-id");
      const opts = {
        idempotencyKey,
        promptMode: flags.get("exact") === true ? ("exact" as const) : ("auto" as const),
        maxCredits: q.credits,
        ...(basedOn ? { basedOn: (await findJob(api, basedOn, t)).id } : {}),
        ...(consentId ? { consentId } : {}),
      };
      const begin = (o: typeof opts & { consentId?: string }) => api.start(model.jobType, params, o).catch(async (e: unknown) => {
        if (!(e instanceof ApiError) || e.code !== "network") throw e;
        await io.sleep(1000);
        return api.start(model.jobType, params, o);
      });
      const job = await begin(opts).catch(async (e: unknown) => {
        // Face Swap and Character Swap show real people: a person confirms in Tevyon, signed in, before the job starts.
        if (!(e instanceof ApiError) || e.code !== "consent_required") throw e;
        const consent = await api.requestConsent(model.jobType, params);
        info(t.consentAsk(consent.url));
        await waitForConsent(io, t, api, consent.id, timeoutOf(str("timeout")));
        return begin({ ...opts, consentId: consent.id });
      });
      info(t.started(model.model, job.id, job.credits));
      if (flags.get("wait") === false) {
        info(t.later(job.id));
        return print(io, json, { job }, job.id);
      }
      return finish(io, t, api, json, await waitFor(io, t, api, job, timeoutOf(str("timeout"))), str("out"));
    }

    case "jobs": {
      const limit = Math.max(1, Math.min(200, Number(str("limit") ?? 20) || 20));
      const status = str("status");
      const list = (await needKey().jobs()).filter((j) => !status || j.status === status).slice(0, limit);
      const lang = pickLang(io.env);
      return print(
        io, json, { jobs: list },
        list.length === 0 ? t.noJobs : table(t.jobsHead, list.map((j) => [
          shortId(j.id), j.model, t.status[j.status] ?? j.status, String(j.credits), when(j.createdAt, lang), truncate(String(j.params.prompt ?? ""), 48),
        ])),
      );
    }

    case "job":
    case "download": {
      const job = await findJob(needKey(), positionals[0], t);
      const done = flags.get("wait") === true ? await waitFor(io, t, api, job, timeoutOf(str("timeout"))) : job;
      if (command === "download" || flags.get("download") === true) return finish(io, t, api, json, done, str("out"));
      const lines = [`${done.model} · ${t.status[done.status] ?? done.status} · ${done.credits} Credits · ${when(done.createdAt, pickLang(io.env))}`, truncate(String(done.params.prompt ?? ""), 200)];
      if (done.error) lines.push(t.failed(done.error));
      if (done.status === "queued" || done.status === "running") lines.push(t.stillRunning(shortId(done.id)));
      return print(io, json, { job: done }, lines.join("\n"));
    }

    case "mcp": {
      const endpoint = `${base}/api/mcp`;
      const keyCmd = io.store.where === "keychain" ? `$(security find-generic-password -s 'Tevyon CLI' -a '${base}' -w)` : "$TEVYON_API_KEY";
      return print(io, json, { endpoint, transport: "http", header: "Authorization: Bearer <api key>" }, t.mcp(endpoint, keyCmd));
    }
  }
  return 0;
}

/**
 * Browser login (RFC 8628): show the code, open Tevyon where someone watches the terminal, poll until the user
 * confirmed (respecting interval and slow_down). Returns the CLI's new API key.
 */
async function deviceLogin(io: Io, t: Messages, api: Api, info: (text: string) => void): Promise<string> {
  const start = await api.deviceAuthorize(io.hostname());
  const url = start.verification_uri_complete ?? start.verification_uri;
  info(t.deviceOpen(url, start.user_code));
  if (io.stdinIsTTY) await io.openUrl(url).catch(() => {});
  let interval = start.interval * 1000;
  const deadline = io.now() + start.expires_in * 1000;
  for (let first = true; ; first = false) {
    if (!first) await io.sleep(interval);
    if (io.now() > deadline) throw new CliError("login_expired", t.loginExpired);
    const res = await api.deviceToken(start.device_code);
    if (res.ok) return res.key;
    if (res.error === "authorization_pending") continue;
    if (res.error === "slow_down") {
      interval += 5000;
      continue;
    }
    if (res.error === "access_denied") throw new CliError("login_denied", t.loginDenied);
    if (res.error === "expired_token") throw new CliError("login_expired", t.loginExpired);
    throw new CliError(res.error, t.serverError(400));
  }
}

function print(io: Io, json: boolean, data: unknown, text: string): number {
  io.stdout.write(`${json ? JSON.stringify(data) : text}\n`);
  return 0;
}

function pickModel(models: Model[], name: string | undefined, t: Messages): Model {
  if (!name) throw new CliError("missing_model", t.missingModel, 2);
  const found = resolveModel(models, name);
  if ("model" in found) return found.model;
  if (found.error === "ambiguous") throw new CliError("ambiguous_model", t.ambiguousModel(name, found.options.map((m) => m.jobType).join(", ")), 2);
  throw new CliError("unknown_model", t.unknownModel(name), 2);
}

function toParams(model: Model, flags: Map<string, string | boolean>, own: Set<string>, prompt: string, t: Messages): Record<string, unknown> {
  const paramFlagsOnly = new Map([...flags].filter(([name]) => !own.has(name)));
  const res = buildParams(model, paramFlagsOnly, prompt);
  if (res.ok) return res.params;
  if (res.error === "unknown_param") throw new CliError("unknown_param", t.unknownParam(res.name, model.model, paramFlags(model).map((f) => `--${f}`).join(", ") || "–"), 2);
  const want = res.want === "boolean" ? t.wantBoolean : res.want === "integer" ? t.wantInteger : t.wantNumber;
  throw new CliError("bad_value", t.badValue(res.name, res.value, want), 2);
}

const PRICE_PLACEHOLDER = "/api/media/uploads/00000000-0000-4000-8000-000000000000/preview.png";
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Reads a local image and puts it into the account's uploads. The server checks the bytes again. */
async function uploadFile(io: Io, t: Messages, api: Api, file: string): Promise<string> {
  const full = path.resolve(io.cwd, file);
  const type = IMAGE_TYPES[path.extname(full).slice(1).toLowerCase()];
  if (!type) throw new CliError("bad_file_type", t.fileType(full), 2);
  let data: Uint8Array;
  try {
    data = await io.readFile(full);
  } catch {
    throw new CliError("file_not_found", t.fileNotFound(full), 2);
  }
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new CliError("file_too_large", t.fileTooLarge(full), 2);
  return api.upload(data, type);
}

function timeoutOf(raw: string | undefined): number {
  const n = Number(raw ?? DEFAULT_TIMEOUT_S);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_S;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A job by its full id or by the beginning of it, as `tevyon jobs` shows it. */
async function findJob(api: Api, id: string | undefined, t: Messages): Promise<Job> {
  if (!id) throw new CliError("missing_job", t.noJob(""), 2);
  if (UUID.test(id)) {
    const [job] = await api.jobs([id]);
    if (job) return job;
    throw new CliError("not_found", t.noJob(id));
  }
  const matches = (await api.jobs()).filter((j) => j.id.startsWith(id.toLowerCase()));
  if (matches.length === 1) return matches[0]!;
  throw new CliError(matches.length ? "ambiguous_job" : "not_found", matches.length ? t.ambiguousJob(id) : t.noJob(id));
}

/** Polls the status batch until the job is done or the time is up. Shows a status line on a terminal. */
/** Waits until the person confirmed the consent in the browser; a decline, an expired request or the timeout start nothing. */
async function waitForConsent(io: Io, t: Messages, api: Api, id: string, timeoutS: number): Promise<void> {
  const start = io.now();
  for (;;) {
    const { state } = await api.consent(id);
    if (state === "confirmed") return;
    if (state === "declined") throw new CliError("consent_declined", t.consentDeclined);
    if (state === "expired" || state === "used") throw new CliError("consent_expired", t.consentExpired);
    if (io.now() - start > timeoutS * 1000) throw new CliError("consent_timeout", t.consentTimeout);
    await io.sleep(3000);
  }
}

async function waitFor(io: Io, t: Messages, api: Api, job: Job, timeoutS: number): Promise<Job> {
  const start = io.now();
  const live = Boolean(io.stderr.isTTY) && !io.argv.includes("--json");
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  let current = job;
  for (let i = 0; current.status === "queued" || current.status === "running"; i++) {
    if (io.now() - start >= timeoutS * 1000) break;
    if (live) io.stderr.write(`\r${frames[i % frames.length]} ${current.model} · ${t.status[current.status]} · ${Math.round((io.now() - start) / 1000)} s`);
    await io.sleep(POLL_MS);
    const [next] = await api.jobs([current.id]);
    if (!next) throw new CliError("not_found", t.noJob(current.id));
    current = next;
  }
  if (live) io.stderr.write("\r\x1b[2K");
  if (current.status === "succeeded" && !io.argv.includes("--json")) io.stderr.write(`${t.done(current.model, Math.round((io.now() - start) / 1000))}\n`);
  return current;
}

/** The end of generate and job --download: report a failure, or save every output and print the paths. */
async function finish(io: Io, t: Messages, api: Api, json: boolean, job: Job, out: string | undefined): Promise<number> {
  if (job.status === "failed") throw new CliError(job.error ?? "failed", t.failed(job.error ?? ""));
  if (job.status !== "succeeded") {
    if (json) io.stdout.write(`${JSON.stringify({ ok: false, error: "still_running", job })}\n`);
    else io.stderr.write(`${t.stillRunning(shortId(job.id))}\n`);
    return 1;
  }
  if (job.outputs.length === 0) return print(io, json, { job, files: [] }, t.noOutputs);
  const dir = path.resolve(io.cwd, out ?? ".");
  const files: string[] = [];
  for (const [i, o] of job.outputs.entries()) {
    const { data, contentType } = await api.download(o.url);
    const file = path.join(dir, outputName(job.model, job.id, i, job.outputs.length, o.contentType || contentType));
    await io.writeFile(file, data);
    files.push(file);
  }
  return print(io, json, { job, files }, files.map((f) => t.saved(f)).join("\n"));
}
