import { describe, expect, it } from "vitest";
import { main, type Io } from "../src/main.ts";
import type { KeyStore } from "../src/store.ts";
import { ACCOUNT, fakeTachyon, KEY, PNG } from "./fake-tachyon.ts";

const BASE = "http://localhost:3100";
let uuids = 0;
/** A fresh UUID per call, as crypto.randomUUID() gives one per CLI run. */
const nextUuid = () => `11111111-2222-4333-8444-${String(++uuids).padStart(12, "0")}`;

function memoryStore(initial?: string): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>(initial ? [[BASE, initial]] : []);
  return {
    where: "keychain",
    data,
    get: async (origin) => data.get(origin),
    set: async (origin, key) => void data.set(origin, key),
    delete: async (origin) => data.delete(origin),
  };
}

type Options = {
  fake?: ReturnType<typeof fakeTachyon>;
  env?: Record<string, string>;
  tty?: boolean;
  answers?: string[];
  stdin?: string;
  key?: string | null;
  fetch?: Io["fetch"];
  disk?: Record<string, Uint8Array>;
};

async function cli(argv: string[], opts: Options = {}) {
  const fake = opts.fake ?? fakeTachyon();
  const store = memoryStore(opts.key === null ? undefined : (opts.key ?? KEY));
  const files = new Map<string, Uint8Array>();
  const opened: string[] = [];
  const slept: number[] = [];
  const asked: { question: string; hidden: boolean }[] = [];
  const answers = [...(opts.answers ?? [])];
  let out = "";
  let err = "";
  let clock = 0;
  const io: Io = {
    argv,
    env: { LANG: "de_CH.UTF-8", ...opts.env },
    fetch: opts.fetch ?? fake.fetch,
    stdout: { write: (s: string) => (out += s) },
    stderr: { write: (s: string) => (err += s) },
    stdinIsTTY: opts.tty ?? false,
    readStdin: async () => opts.stdin ?? "",
    ask: async (question, o = {}) => {
      asked.push({ question, hidden: Boolean(o.hidden) });
      return answers.shift() ?? "";
    },
    store,
    openUrl: async (url) => void opened.push(url),
    hostname: () => "MacBook",
    writeFile: async (file, data) => void files.set(file, data),
    readFile: async (file) => {
      const data = opts.disk?.[file];
      if (!data) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
      return data;
    },
    cwd: "/work",
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    uuid: nextUuid,
  };
  const code = await main(io);
  return { code, out, err, files, store, fake, asked, opened, slept };
}

describe("tevyon cli", () => {
  describe("models", () => {
    it("lists every model with its job type and the price it starts from, without a login", async () => {
      const fake = fakeTachyon();
      const r = await cli(["models"], { key: null, fake });
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/^JOB-TYP\s+MODELL\s+ART\s+AB\s+BESCHREIBUNG/);
      expect(r.out).toMatch(/test_image\s+Test Image 2\s+Bild\s+4 Cr\.\s+Test maker · stills/);
      // «ab» is the cheapest setting from the public price list, as on the website (not the default settings' price).
      expect(r.out).toMatch(/test_video\s+Test Video 3\s+Video\s+12 Cr\./);
      // One request for all prices instead of one quote per model.
      expect(fake.requests.filter((q) => q.path === "/api/quote")).toHaveLength(0);
    });

    it("marks a model that runs out", async () => {
      const r = await cli(["models"], { key: null, fake: fakeTachyon({ deprecated: ["test_video"] }) });
      expect(r.out).toMatch(/test_video\s+Test Video 3 \(läuft aus\)/);
    });

    it("filters by kind and answers in JSON for agents", async () => {
      const r = await cli(["models", "--kind", "video", "--json"]);
      const data = JSON.parse(r.out);
      expect(data.models.map((m: { jobType: string }) => m.jobType)).toEqual(["test_video"]);
      expect(data.models[0]).toMatchObject({ priceFrom: 12, priceStandard: 32, status: "active", params: { properties: { duration: expect.any(Object) } } });
    });
  });

  describe("price", () => {
    it("shows the price, the balance and the hints on the prompt, and starts nothing", async () => {
      const r = await cli(["price", "test_video", "a fox in snow", "--duration", "4"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Test Video 3: 16 Credits");
      expect(r.out).toContain("Guthaben: 100 Credits");
      expect(r.out).toContain("Keine Kamera angegeben.");
      expect(r.fake.started()).toEqual([]);
    });

    it("needs no login", async () => {
      const r = await cli(["price", "test_image"], { key: null });
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("Test Image 2: 4 Credits");
    });
  });

  describe("generate", () => {
    it("refuses without a login", async () => {
      const r = await cli(["generate", "test_image", "a fox", "--yes"], { key: null });
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/Nicht angemeldet.*tevyon login/);
      expect(r.fake.started()).toEqual([]);
    });

    it("shows the price and starts nothing without --yes when no one can answer", async () => {
      const r = await cli(["generate", "test_video", "a fox runs through snow"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("Test Video 3: 32 Credits · Guthaben: 100 Credits");
      expect(r.err).toContain("Ohne Terminal bitte mit --yes bestätigen");
      expect(r.fake.started()).toEqual([]);
    });

    it("asks on a terminal and starts nothing on no", async () => {
      const r = await cli(["generate", "test_image", "a fox"], { tty: true, answers: ["n"] });
      expect(r.asked.map((a) => a.question)).toEqual(["Für 4 Credits starten? [j/N] "]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("Abgebrochen, nichts gestartet.");
      expect(r.fake.started()).toEqual([]);
    });

    it("starts on yes, waits for the result, saves the file and prints its path", async () => {
      const r = await cli(["generate", "test_image", "a", "red", "fox", "--out", "renders"], { tty: true, answers: ["ja"] });
      expect(r.code).toBe(0);
      expect(r.fake.started()[0]?.body.params).toEqual({ prompt: "a red fox" });
      const file = "/work/renders/test-image-2-00000001.png";
      expect(r.files.get(file)).toEqual(PNG);
      expect(r.out.trim()).toBe(`Gespeichert: ${file}`);
      expect(r.err).toMatch(/Gestartet: Test Image 2 · Job 00000001-.* · 4 Credits reserviert/);
      expect(r.fake.credits).toBe(96);
    });

    it("sends one idempotency key, the shown price as the limit and the client header", async () => {
      const r = await cli(["generate", "test_image", "a fox", "--yes"]);
      const [start] = r.fake.started();
      expect(start?.headers.get("idempotency-key")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(start?.headers.get("x-tachyon-client")).toBe("cli");
      expect(start?.body).toMatchObject({ maxCredits: 4, promptMode: "auto" });
    });

    it("retries a start whose answer got lost with the same key, so the job runs and costs only once", async () => {
      const fake = fakeTachyon();
      fake.failNextStartNetwork();
      const r = await cli(["generate", "test_image", "a fox", "--yes"], { fake });
      expect(r.code).toBe(0);
      const [first, second] = fake.started().map((s) => s.headers.get("idempotency-key"));
      expect(second).toBe(first);
      expect(fake.jobs.size).toBe(1);
      expect(fake.credits).toBe(96);
    });

    it("turns flags into the model's parameters, typed by its schema", async () => {
      const r = await cli(["generate", "test_video", "a fox", "--duration", "4", "--no-generate-audio", "--yes", "--no-wait"]);
      expect(r.code).toBe(0);
      expect(r.fake.started()[0]?.body.params).toEqual({ prompt: "a fox", duration: 4, generate_audio: false });
    });

    it("does not take the prompt as the value of a boolean flag", async () => {
      const r = await cli(["generate", "test_video", "--generate-audio", "a fox runs", "--yes", "--no-wait"]);
      expect(r.fake.started()[0]?.body.params).toEqual({ prompt: "a fox runs", generate_audio: true });
    });

    it("sends --exact and --based-on for own finished prompts and finals built on a draft", async () => {
      const fake = fakeTachyon();
      await cli(["generate", "test_video", "a fox", "--duration", "4", "--yes", "--no-wait"], { fake });
      const draft = [...fake.jobs.keys()][0]!;
      const r = await cli(["generate", "test_video", "a fox", "--exact", "--based-on", draft.slice(0, 8), "--yes", "--no-wait"], { fake });
      expect(r.code).toBe(0);
      expect(fake.started()[1]?.body).toMatchObject({ promptMode: "exact", basedOn: draft });
    });

    it("uploads a local start image first and sends its Tevyon path", async () => {
      const r = await cli(["generate", "test_video", "the person laughs", "--image", "fox.png", "--yes", "--no-wait"], { disk: { "/work/fox.png": PNG } });
      expect(r.code).toBe(0);
      expect(r.fake.uploads).toEqual([PNG]);
      const path = `/api/media/uploads/${ACCOUNT}/upload-1.png`;
      expect(r.fake.started()[0]?.body.params).toEqual({ prompt: "the person laughs", image: path });
      expect(r.fake.requests.findIndex((q) => q.path === "/api/uploads")).toBeLessThan(r.fake.requests.findIndex((q) => q.path === "/api/quote"));
    });

    it("takes an earlier upload's path as it is", async () => {
      const path = `/api/media/uploads/${ACCOUNT}/earlier.png`;
      const r = await cli(["generate", "test_video", "the person laughs", "--image", path, "--yes", "--no-wait"]);
      expect(r.fake.uploads).toEqual([]);
      expect(r.fake.started()[0]?.body.params.image).toBe(path);
    });

    it("stops before anything costs when the start image is missing", async () => {
      const r = await cli(["generate", "test_video", "the person laughs", "--image", "nope.png", "--yes"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("Datei nicht gefunden: /work/nope.png");
      expect(r.fake.started()).toEqual([]);
    });

    it("rejects an unknown flag and a wrong value, saying what the model takes", async () => {
      const unknown = await cli(["generate", "test_video", "a fox", "--colour", "red", "--yes"]);
      expect(unknown.code).toBe(2);
      expect(unknown.err).toContain("Test Video 3 kennt keine Option --colour. Möglich: --duration, --generate-audio, --image.");

      const wrong = await cli(["generate", "test_video", "a fox", "--duration", "acht", "--yes"]);
      expect(wrong.code).toBe(2);
      expect(wrong.err).toContain("--duration braucht eine Zahl, nicht «acht».");
      expect(wrong.fake.started()).toEqual([]);
    });

    it("finds a model by its name or by a unique beginning", async () => {
      for (const name of ["Test Video 3", "test-video", "test_v"]) {
        const r = await cli(["generate", name, "a fox", "--yes", "--no-wait"]);
        expect(r.fake.started()[0]?.path).toBe("/api/jobs/test_video");
      }
      const both = await cli(["generate", "test", "a fox", "--yes"]);
      expect(both.code).toBe(2);
      expect(both.err).toContain("«test» passt auf mehrere Modelle: test_image, test_video, test_swap.");
    });

    it("explains a failed job, saves nothing and exits with 1", async () => {
      const r = await cli(["generate", "test_image", "a fox", "--yes"], { fake: fakeTachyon({ outcome: "fail" }) });
      expect(r.code).toBe(1);
      expect(r.err).toContain("Der Sicherheitsfilter des Modells hat die Anfrage blockiert. Alle Credits sind zurückgebucht.");
      expect(r.files.size).toBe(0);
      expect(r.fake.credits).toBe(100);
    });

    it("refuses a job the account cannot pay for before it starts", async () => {
      const r = await cli(["generate", "test_video", "a fox", "--yes"], { fake: fakeTachyon({ credits: 10 }) });
      expect(r.code).toBe(1);
      expect(r.err).toContain("Zu wenig Credits: Der Job kostet 32, verfügbar sind 10.");
      expect(r.fake.started()).toEqual([]);
    });

    it("says when the key's daily limit is reached instead of a bare HTTP error", async () => {
      const r = await cli(["generate", "test_video", "a fox", "--yes"], { fake: fakeTachyon({ keyLimit: { limit: 300, used: 290 } }) });
      expect(r.code).toBe(1);
      expect(r.err).toContain("Tageslimit dieses Schlüssels erreicht: 290 von 300 Credits in 24 Stunden.");
      expect(r.err).toContain("API & MCP");
    });

    it("with --no-wait only starts the job and says how to fetch it later", async () => {
      const r = await cli(["generate", "test_image", "a fox", "--yes", "--no-wait"]);
      expect(r.code).toBe(0);
      expect(r.err).toMatch(/tevyon job 00000001-\S+ --wait/);
      expect(r.fake.requests.some((q) => q.path.startsWith("/api/jobs?ids="))).toBe(false);
    });

    it("gives up waiting after --timeout and says how to go on", async () => {
      const r = await cli(["generate", "test_video", "a fox", "--yes", "--timeout", "10"], { fake: fakeTachyon({ outcome: "never" }) });
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/Noch nicht fertig. Weiter warten: tevyon job 00000001 --wait/);
    });

    it("prints one JSON object for agents and nothing else on stdout", async () => {
      const r = await cli(["generate", "test_image", "a fox", "--yes", "--json", "--out", "/tmp/x"], { fake: fakeTachyon({ outputs: 2 }) });
      expect(r.code).toBe(0);
      const data = JSON.parse(r.out);
      expect(data.job).toMatchObject({ status: "succeeded", credits: 4 });
      expect(data.files).toEqual(["/tmp/x/test-image-2-00000001-1.png", "/tmp/x/test-image-2-00000001-2.png"]);
      expect(r.err).toBe("");
    });

    it("answers errors as JSON with a code when --json is set", async () => {
      const r = await cli(["generate", "test_image", "a fox", "--json"]);
      expect(r.code).toBe(2);
      expect(JSON.parse(r.out)).toMatchObject({ ok: false, error: "confirmation_required" });
    });
  });

  describe("login", () => {
    it("logs in through the browser: shows the code, opens Tevyon, waits for the confirmation and stores the key", async () => {
      const r = await cli(["login"], { key: null, tty: true });
      expect(r.code).toBe(0);
      expect(r.opened).toEqual([`${BASE}/device?code=WDJB-MJHT`]);
      expect(r.err).toContain("WDJB-MJHT");
      expect(r.fake.requests.find((q) => q.path === "/oauth/device_authorization")?.body).toContain("name=MacBook");
      // pending → wait 5 s, slow_down → wait 10 s, then the key
      expect(r.slept).toEqual([5000, 10000]);
      expect(r.store.data.get(BASE)).toBe(KEY);
      expect(r.out).toContain("Angemeldet als user@example.com · 100 Credits");
      expect(r.out).not.toContain(KEY);
    });

    it("says how long to wait when there were too many login attempts", async () => {
      const r = await cli(["login"], { key: null, fake: fakeTachyon({ device: "throttled" }) });
      expect(r.code).toBe(1);
      expect(r.err).toContain("Zu viele Anmeldeversuche. Versuche es in 9 Minuten noch einmal.");
      expect(r.store.data.size).toBe(0);
    });

    it("prints the address instead of opening a browser where nobody watches", async () => {
      const r = await cli(["login"], { key: null, tty: false });
      expect(r.opened).toEqual([]);
      expect(r.err).toContain(`${BASE}/device?code=WDJB-MJHT`);
      expect(r.code).toBe(0);
    });

    it("stores nothing when the login is declined or runs out", async () => {
      const denied = await cli(["login"], { key: null, fake: fakeTachyon({ device: "deny" }) });
      expect(denied.code).toBe(1);
      expect(denied.err).toContain("Die Anmeldung wurde in Tevyon Studio abgelehnt.");
      expect(denied.store.data.size).toBe(0);

      const late = await cli(["login"], { key: null, fake: fakeTachyon({ device: "expire" }) });
      expect(late.code).toBe(1);
      expect(late.err).toContain("abgelaufen");
    });

    it("checks a piped key with the server and stores it", async () => {
      const r = await cli(["login", "--with-key"], { key: null, stdin: `${KEY}\n` });
      expect(r.code).toBe(0);
      expect(r.store.data.get(BASE)).toBe(KEY);
      expect(r.out).toContain("Angemeldet als user@example.com · 100 Credits. Schlüssel gespeichert im macOS-Schlüsselbund");
      expect(r.out).not.toContain(KEY);
    });

    it("asks for the key without showing it on a terminal", async () => {
      const r = await cli(["login", "--with-key"], { key: null, tty: true, answers: [KEY] });
      expect(r.asked).toEqual([{ question: "API-Schlüssel (aus Tevyon Studio → API & MCP): ", hidden: true }]);
      expect(r.store.data.get(BASE)).toBe(KEY);
    });

    it("rejects something that is not a key without sending it anywhere", async () => {
      const r = await cli(["login", "--key", "sk_live_123"], { key: null });
      expect(r.code).toBe(2);
      expect(r.err).toContain("kein Tevyon-API-Schlüssel");
      expect(r.fake.requests).toEqual([]);
    });

    it("stores nothing when the server does not know the key", async () => {
      const r = await cli(["login", "--key", `tch_${"B".repeat(40)}`], { key: null });
      expect(r.code).toBe(1);
      expect(r.err).toContain("ungültig oder widerrufen");
      expect(r.store.data.size).toBe(0);
    });
  });

  it("logout removes the stored key", async () => {
    const r = await cli(["logout"]);
    expect(r.code).toBe(0);
    expect(r.store.data.size).toBe(0);
    expect(r.out).toContain("Abgemeldet.");
  });

  it("whoami shows the account and its credits", async () => {
    const r = await cli(["whoami"]);
    expect(r.out.trim()).toBe("user@example.com · 100 Credits");
  });

  it("prefers TEVYON_API_KEY over the stored key", async () => {
    const r = await cli(["whoami"], { key: `tch_${"C".repeat(40)}`, env: { TEVYON_API_KEY: KEY } });
    expect(r.code).toBe(0);
  });

  it("still takes the old TACHYON_API_KEY and TACHYON_URL from before the rename", async () => {
    const r = await cli(["whoami"], { key: `tch_${"C".repeat(40)}`, env: { TACHYON_API_KEY: KEY } });
    expect(r.code).toBe(0);
    const old = await cli(["whoami"], { env: { TACHYON_URL: "http://old.example:4000", TACHYON_API_KEY: KEY }, fetch: async () => { throw new TypeError("fetch failed"); } });
    expect(old.err).toContain("Tevyon ist unter http://old.example:4000 nicht erreichbar.");
  });

  it("TEVYON_URL points the CLI at another server and wins over the old name", async () => {
    const r = await cli(["whoami"], { env: { TEVYON_URL: "http://new.example:4000", TACHYON_URL: "http://old.example:4000", TEVYON_API_KEY: KEY }, fetch: async () => { throw new TypeError("fetch failed"); } });
    expect(r.err).toContain("Tevyon ist unter http://new.example:4000 nicht erreichbar.");
  });

  describe("jobs", () => {
    it("lists jobs with short ids, newest first", async () => {
      const fake = fakeTachyon();
      await cli(["generate", "test_image", "first fox", "--yes", "--no-wait"], { fake });
      await cli(["generate", "test_video", "second fox", "--yes", "--no-wait"], { fake });
      const r = await cli(["jobs"], { fake });
      const lines = r.out.trim().split("\n");
      expect(lines[0]).toMatch(/^ID\s+MODELL\s+STATUS\s+CREDITS\s+ERSTELLT\s+PROMPT$/);
      expect(lines[1]).toMatch(/^00000002\s+Test Video 3\s+in der Warteschlange\s+32\s+.*second fox$/);
      expect(lines[2]).toMatch(/^00000001\s+Test Image 2/);
    });

    it("finds a job by the beginning of its id, waits and downloads its files", async () => {
      const fake = fakeTachyon();
      await cli(["generate", "test_image", "a fox", "--yes", "--no-wait"], { fake });
      const r = await cli(["job", "00000001", "--wait", "--download", "--out", "dl"], { fake });
      expect(r.code).toBe(0);
      expect([...r.files.keys()]).toEqual(["/work/dl/test-image-2-00000001.png"]);
    });
  });

  it("upload puts an image into the account and prints its path for --image", async () => {
    const r = await cli(["upload", "shots/fox.png"], { disk: { "/work/shots/fox.png": PNG } });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(`/api/media/uploads/${ACCOUNT}/upload-1.png`);
    expect(r.fake.requests.at(-1)?.headers.get("content-type")).toBe("image/png");
  });

  describe("credits", () => {
    it("shows the statement: the summary and every movement with channel and balance", async () => {
      const fake = fakeTachyon();
      await cli(["generate", "test_image", "a fox", "--yes"], { fake });
      const r = await cli(["credits"], { fake });
      expect(r.code).toBe(0);
      const lines = r.out.trim().split("\n");
      expect(lines[0]).toBe("Verfügbar 96 · reserviert 0 · ausgegeben 4 · zurückgebucht 0 · gutgeschrieben 100");
      expect(r.out).toMatch(/DATUM\s+BEWEGUNG\s+KANAL\s+CREDITS\s+SALDO/);
      expect(r.out).toMatch(/Test Image 2 · abgebucht\s+CLI\s+-4\s+96/);
      expect(r.out).toMatch(/Willkommensguthaben\s+–\s+\+100\s+100/);
    });

    it("names every kind of movement and says until when plan credits run", async () => {
      const at = Date.UTC(2026, 10, 1, 9);
      const fake = fakeTachyon({
        statement: {
          expiring: { credits: 1_200, at: Date.UTC(2026, 10, 15, 0) },
          entries: [
            { id: "x1", at, credits: -300, balance: 900, kind: "expiry" },
            { id: "d1", at, credits: -16, balance: 1_200, kind: "director", model: "Claude Fable 5.1", state: "charged", amount: 16 },
            { id: "r1", at, credits: -1_000, balance: 1_216, kind: "reversal", source: "refund" },
            { id: "g2", at, credits: 2_000, balance: 2_216, kind: "grant", source: "subscription" },
          ],
        },
      });
      const r = await cli(["credits"], { fake });
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("undefined");
      expect(r.out).toMatch(/davon 1200 Abo-Credits bis 15\.11\.2026/);
      expect(r.out).toMatch(/Abo-Credits verfallen\s+–\s+-300/);
      expect(r.out).toMatch(/Director · Claude Fable 5\.1 · abgebucht/);
      expect(r.out).toMatch(/Rückerstattung\s+–\s+-1000/);
      expect(r.out).toMatch(/Abo-Credits\s+–\s+\+2000/);
    });

    it("limits the movements, answers in JSON and hands the server's CSV through", async () => {
      const json = await cli(["credits", "--limit", "1", "--json"]);
      expect(json.fake.requests.at(-1)?.path).toBe("/api/credits?limit=1");
      expect(JSON.parse(json.out).summary).toMatchObject({ available: 100 });

      const csv = await cli(["credits", "--csv"]);
      expect(csv.out.startsWith("\uFEFFDatum;Art;")).toBe(true);
    });
  });

  it("prints how to connect the MCP server, with a keychain lookup instead of the key", async () => {
    const r = await cli(["mcp"]);
    expect(r.out).toContain(`claude mcp add --transport http --scope user tevyon ${BASE}/api/mcp\n`);
    expect(r.out).toContain(`claude mcp add --transport http --scope user tevyon ${BASE}/api/mcp \\`);
    expect(r.out).toContain(`--header "Authorization: Bearer $(security find-generic-password -s 'Tevyon CLI' -a '${BASE}' -w)"`);
    expect(r.out).not.toContain(KEY);
  });

  describe("swaps with real people", () => {
    const swap = (extra: string[] = []) => [
      "generate", "test_swap", "--image", `/api/media/uploads/${ACCOUNT}/target.png`, "--face", `/api/media/uploads/${ACCOUNT}/face.png`,
      "--consent", "true", "--yes", "--no-wait", ...extra,
    ];

    it("asks the person to confirm in Tevyon, waits for it and then starts the swap once", async () => {
      const fake = fakeTachyon();
      const r = await cli(swap(), { fake });
      expect(r.code).toBe(0);
      expect(r.err).toContain(`${BASE}/consent/c0000000-aaaa-4bbb-8ccc-000000000001`);
      const starts = fake.requests.filter((q) => q.path === "/api/jobs/test_swap");
      expect(starts.map((q) => q.body.consentId)).toEqual([undefined, "c0000000-aaaa-4bbb-8ccc-000000000001"]);
      // Waited for the browser between the polls, without a prompt of its own (the swap needs none).
      expect(r.slept.length).toBeGreaterThan(0);
    });

    it("stops when the person declines", async () => {
      const r = await cli(swap(), { fake: fakeTachyon({ consent: "decline" }) });
      expect(r.code).not.toBe(0);
      expect(r.err).toMatch(/abgelehnt/i);
    });
  });

  it("has no skill commands any more: the skills stay on the server", async () => {
    for (const command of ["skills", "skill"]) {
      const r = await cli([command], { key: null });
      expect(r.code, command).not.toBe(0);
    }
  });

  it("speaks English outside a German locale", async () => {
    const r = await cli(["whoami"], { key: null, env: { LANG: "en_US.UTF-8" } });
    expect(r.err).toContain("Not signed in. Run `tevyon login`");
  });

  it("says when Tevyon cannot be reached", async () => {
    const r = await cli(["whoami"], { fetch: async () => { throw new TypeError("fetch failed"); } });
    expect(r.code).toBe(1);
    expect(r.err).toContain("Tevyon ist unter http://localhost:3100 nicht erreichbar.");
  });

  it("rejects an unknown command with exit code 2", async () => {
    const r = await cli(["fly"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Unbekannter Befehl «fly»");
  });

  it("shows the help without a command", async () => {
    const r = await cli([], { key: null });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Verwendung: tevyon <befehl> [optionen]");
  });
});
