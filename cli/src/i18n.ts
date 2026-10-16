/** Every text a person reads, in German and English. */
export type Lang = "de" | "en";

export function pickLang(env: Record<string, string | undefined>): Lang {
  const v = (env.TEVYON_LANG ?? env.TACHYON_LANG ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? "").toLowerCase();
  return v.startsWith("de") ? "de" : "en";
}

const FAILURES = {
  de: {
    content_moderated: "Der Sicherheitsfilter des Modells hat die Anfrage blockiert. Alle Credits sind zurückgebucht.",
    invalid_request: "Das Modell hat diese Einstellungen abgelehnt. Alle Credits sind zurückgebucht.",
    generation_failed: "Die Generierung ist fehlgeschlagen. Alle Credits sind zurückgebucht.",
    timed_out: "Die Generierung hat zu lange gedauert und wurde abgebrochen. Alle Credits sind zurückgebucht.",
  },
  en: {
    content_moderated: "The model's safety filter blocked the request. All credits were refunded.",
    invalid_request: "The model rejected these settings. All credits were refunded.",
    generation_failed: "The generation failed. All credits were refunded.",
    timed_out: "The generation took too long and was stopped. All credits were refunded.",
  },
} as const;

const de = {
  notLoggedIn: "Nicht angemeldet. Melde dich mit «tevyon login» an (API-Schlüssel aus Tevyon Studio → API & MCP).",
  keyInvalid: "Der API-Schlüssel ist ungültig oder widerrufen. Neuen Schlüssel holen und «tevyon login» ausführen.",
  keyFormat: "Das ist kein Tevyon-API-Schlüssel. Er beginnt mit tch_ und hat 44 Zeichen.",
  askKey: "API-Schlüssel (aus Tevyon Studio → API & MCP): ",
  deviceOpen: (url: string, code: string) => `Bestätige die Anmeldung im Browser:\n  ${url}\nCode zum Vergleichen: ${code}\nWarte auf die Bestätigung …`,
  loginDenied: "Die Anmeldung wurde in Tevyon Studio abgelehnt.",
  loginExpired: "Die Anmeldung ist abgelaufen. Starte «tevyon login» noch einmal.",
  whereKeychain: "im macOS-Schlüsselbund (Dienst «Tevyon CLI»)",
  whereFile: (path: string) => `in ${path}`,
  loggedIn: (email: string, credits: number, where: string) => `Angemeldet als ${email} · ${credits} Credits. Schlüssel gespeichert ${where}.`,
  loggedOut: "Abgemeldet. Der Schlüssel ist von diesem Rechner entfernt. Widerrufen kannst du ihn in Tevyon Studio → API & MCP.",
  notStored: "Auf diesem Rechner ist kein Schlüssel gespeichert.",
  envKeyNote: "Hinweis: TEVYON_API_KEY ist gesetzt und hat Vorrang vor dem gespeicherten Schlüssel.",
  whoami: (email: string, credits: number, demo: boolean) => `${email} · ${credits} Credits${demo ? " · Demo-Modus (Platzhalter-Ergebnisse, keine Kosten)" : ""}`,
  unknownCommand: (cmd: string) => `Unbekannter Befehl «${cmd}». «tevyon help» zeigt alle Befehle.`,
  missingModel: "Welches Modell? Beispiel: tevyon generate flux_3_image \"ein roter Fuchs im Schnee\". «tevyon models» zeigt alle.",
  unknownModel: (name: string) => `Kein Modell «${name}». «tevyon models» zeigt alle Modelle.`,
  ambiguousModel: (name: string, options: string) => `«${name}» passt auf mehrere Modelle: ${options}.`,
  missingPrompt: "Es fehlt der Prompt. Beispiel: tevyon generate flux_3_image \"ein roter Fuchs im Schnee\"",
  unknownParam: (name: string, model: string, allowed: string) => `${model} kennt keine Option --${name}. Möglich: ${allowed}.`,
  badValue: (name: string, value: string, want: string) => `--${name} braucht ${want}, nicht «${value}».`,
  wantNumber: "eine Zahl",
  wantInteger: "eine ganze Zahl",
  wantBoolean: "ja oder nein",
  missingValue: (name: string) => `--${name} braucht einen Wert.`,
  invalidParams: (issues: string) => `Ungültige Einstellungen: ${issues}`,
  price: (model: string, credits: number) => `${model}: ${credits} Credits`,
  balance: (credits: number) => `Guthaben: ${credits} Credits`,
  notes: "Hinweise zum Prompt:",
  notEnough: (credits: number, balance: number) => `Zu wenig Credits: Der Job kostet ${credits}, verfügbar sind ${balance}. Aufladen in Tevyon Studio.`,
  confirm: (credits: number) => `Für ${credits} Credits starten? [j/N] `,
  yes: /^(j|ja|y|yes)$/i,
  needsYes: (credits: number) => `Dieser Job kostet ${credits} Credits. Ohne Terminal bitte mit --yes bestätigen.`,
  cancelled: "Abgebrochen, nichts gestartet.",
  consentAsk: (url: string) => `Dieser Job zeigt echte Personen. Bestätige in Tevyon (angemeldet), dass du die Rechte an den Bildern und die Einwilligung aller Abgebildeten hast:\n  ${url}\nIch warte auf die Bestätigung …`,
  consentDeclined: "Die Einwilligung wurde abgelehnt. Nichts gestartet.",
  consentExpired: "Die Einwilligungsanfrage ist abgelaufen oder schon verwendet. Nichts gestartet.",
  consentTimeout: "Keine Bestätigung in der Wartezeit. Nichts gestartet; mit --consent-id <id> später fortsetzen.",
  started: (model: string, id: string, credits: number) => `Gestartet: ${model} · Job ${id} · ${credits} Credits reserviert`,
  later: (id: string) => `Ergebnis später holen: tevyon job ${id} --wait`,
  status: { queued: "in der Warteschlange", running: "läuft", succeeded: "fertig", failed: "fehlgeschlagen" } as Record<string, string>,
  done: (model: string, seconds: number) => `Fertig: ${model} nach ${seconds} s`,
  saved: (path: string) => `Gespeichert: ${path}`,
  failed: (code: string) => (FAILURES.de as Record<string, string>)[code] ?? "Der Job ist fehlgeschlagen. Alle Credits sind zurückgebucht.",
  stillRunning: (id: string) => `Noch nicht fertig. Weiter warten: tevyon job ${id} --wait`,
  retired: (model: string, successor?: string) => `${model} ist nicht mehr verfügbar.${successor ? ` Nachfolger: ${successor}.` : ""}`,
  paused: (model: string) => `${model} ist gerade pausiert. Versuche es später oder nimm ein anderes Modell.`,
  priceChanged: (credits: number) => `Der Preis hat sich eben geändert: Der Job kostet jetzt ${credits} Credits. Nichts gestartet, nichts belastet. Führe den Befehl erneut aus.`,
  network: (base: string) => `Tevyon ist unter ${base} nicht erreichbar.`,
  serverError: (status: number) => `Tevyon hat mit einem Fehler geantwortet (HTTP ${status}). Versuche es gleich noch einmal.`,
  tooMany: (minutes: number) => `Zu viele Anmeldeversuche. Versuche es in ${minutes} ${minutes === 1 ? "Minute" : "Minuten"} noch einmal.`,
  keyLimit: (used: number, limit: number) =>
    `Tageslimit dieses Schlüssels erreicht: ${used} von ${limit} Credits in 24 Stunden. Erhöhen kannst du es in Tevyon Studio → API & MCP.`,
  fileNotFound: (file: string) => `Datei nicht gefunden: ${file}`,
  fileType: (file: string) => `${file}: Startbilder gehen als PNG, JPEG oder WebP.`,
  fileTooLarge: (file: string) => `${file} ist grösser als 10 MB.`,
  noJob: (id: string) => `Kein Job «${id}» in diesem Konto.`,
  ambiguousJob: (id: string) => `«${id}» passt auf mehrere Jobs. Gib mehr Zeichen der ID an.`,
  noJobs: "Noch keine Jobs.",
  noOutputs: "Dieser Job hat keine Dateien.",
  kind: { image: "Bild", video: "Video" } as Record<string, string>,
  modelsHead: ["JOB-TYP", "MODELL", "ART", "AB", "BESCHREIBUNG"],
  runsOut: "läuft aus",
  pausedTag: "pausiert",
  jobsHead: ["ID", "MODELL", "STATUS", "CREDITS", "ERSTELLT", "PROMPT"],
  credits: (n: number | null) => (n === null ? "–" : `${n} Cr.`),
  creditsSummary: (s: { available: number; reserved: number; spent: number; refunded: number; granted: number }) =>
    `Verfügbar ${s.available} · reserviert ${s.reserved} · ausgegeben ${s.spent} · zurückgebucht ${s.refunded} · gutgeschrieben ${s.granted}`,
  creditsHead: ["DATUM", "BEWEGUNG", "KANAL", "CREDITS", "SALDO"],
  grant: { welcome: "Willkommensguthaben", purchase: "Kauf", subscription: "Abo-Credits", adjustment: "Korrektur" } as Record<string, string>,
  charge: { reserved: "reserviert", charged: "abgebucht", refunded: "zurückgebucht" } as Record<string, string>,
  reversal: { refund: "Rückerstattung", dispute: "Zahlungsstreit", dispute_won: "Zahlungsstreit beigelegt" } as Record<string, string>,
  expiry: "Abo-Credits verfallen",
  expiring: (credits: number, until: string) => `davon ${credits} Abo-Credits bis ${until}, sie werden zuerst verbraucht`,
  origin: { web: "Studio", mcp: "MCP", cli: "CLI", api: "API" } as Record<string, string>,
  noEntries: "Noch keine Bewegungen.",
  mcp: (endpoint: string, keyCmd: string) => [
    `Tevyon als MCP-Server verbinden. Endpunkt: ${endpoint}`,
    "",
    "Claude Code mit Anmeldung im Browser (für alle Projekte):",
    `  claude mcp add --transport http --scope user tevyon ${endpoint}`,
    "",
    "Claude Code mit deinem API-Schlüssel:",
    `  claude mcp add --transport http --scope user tevyon ${endpoint} \\`,
    `    --header "Authorization: Bearer ${keyCmd}"`,
    "",
    "Cursor, Windsurf und andere (mcp.json):",
    `  { "mcpServers": { "tevyon": { "url": "${endpoint}", "headers": { "Authorization": "Bearer <dein Schlüssel>" } } } }`,
    "",
    "Der Client speichert den Schlüssel in seiner eigenen Konfiguration. Widerrufen kannst du ihn jederzeit in Tevyon Studio → API & MCP.",
  ].join("\n"),
  help: `Tevyon CLI: Bilder und Videos mit führenden Modellen, der Preis vor jedem Job.

Verwendung: tevyon <befehl> [optionen]

Konto
  login                       Anmelden über den Browser: Code in Tevyon Studio bestätigen
  login --with-key            Vorhandenen API-Schlüssel einfügen (verdeckt) oder über stdin übergeben
  login --key <schlüssel>     Schlüssel direkt angeben (landet in der Shell-History)
  logout                      Schlüssel von diesem Rechner entfernen
  whoami                      Konto und Guthaben
  credits [--limit <n>] [--csv]
                              Kontoauszug: verfügbar, reserviert, ausgegeben, jede Bewegung

Erstellen
  models [--kind image|video] Modelle mit Job-Typ und Preis ab
  price <modell> [prompt] [--<parameter> <wert> …]
                              Preis in Credits und Hinweise zum Prompt. Kostet nichts.
  generate <modell> <prompt> [--<parameter> <wert> …]
                              Job starten (Preis wird vorher gezeigt), warten, Dateien speichern.
      --yes                   ohne Rückfrage starten (nötig ohne Terminal)
      --out <ordner>          Zielordner für die Dateien (Standard: aktueller Ordner)
      --no-wait               nur starten, nicht warten
      --exact                 eigenen fertigen Prompt unverändert senden (sonst schreibt Tevyon ihn)
      --based-on <job-id>     Final auf einem Entwurf aufbauen (übernimmt dessen Prompt)
      --consent-id <id>       Face/Character Swap: schon bestätigte Einwilligung verwenden
      --image <datei>         Startbild (Bild → Video): eine lokale Datei wird vorher hochgeladen
      --timeout <sekunden>    höchstens so lange warten (Standard 1200)
  jobs [--limit <n>] [--status <status>]
                              Letzte Jobs
  job <id> [--wait] [--download] [--out <ordner>]
                              Status eines Jobs, auf Wunsch warten und Dateien laden
  upload <datei>              Bild hochladen, gibt den Pfad für --image aus

Agenten
  mcp                         Tevyon als MCP-Server in Claude Code, Cursor & Co. verbinden

Allgemein
  --json                      maschinenlesbare Ausgabe auf stdout (für Skripte und Agenten)
  --url <adresse>             Tevyon-Server (Standard: TEVYON_URL oder http://localhost:3100)
  -h, --help · -v, --version

Parameter je Modell zeigt «tevyon models --json». Beispiele:
  tevyon generate flux_3_image "ein roter Fuchs im Schnee" --aspect-ratio 16:9
  tevyon generate veo_3_1_lite "Kamerafahrt durch einen nebligen Wald" --duration 8 --yes`,
};

type Messages = typeof de;

const en: Messages = {
  notLoggedIn: "Not signed in. Run `tevyon login` (API key from Tevyon Studio → API & MCP).",
  keyInvalid: "The API key is invalid or revoked. Get a new key and run `tevyon login`.",
  keyFormat: "That is not a Tevyon API key. It starts with tch_ and has 44 characters.",
  askKey: "API key (from Tevyon Studio → API & MCP): ",
  deviceOpen: (url, code) => `Confirm the login in your browser:\n  ${url}\nCode to compare: ${code}\nWaiting for the confirmation …`,
  loginDenied: "The login was declined in Tevyon Studio.",
  loginExpired: "The login expired. Run \`tevyon login\` again.",
  whereKeychain: "in the macOS keychain (service “Tevyon CLI”)",
  whereFile: (path) => `in ${path}`,
  loggedIn: (email, credits, where) => `Signed in as ${email} · ${credits} credits. Key stored ${where}.`,
  loggedOut: "Signed out. The key was removed from this machine. Revoke it in Tevyon Studio → API & MCP.",
  notStored: "No key is stored on this machine.",
  envKeyNote: "Note: TEVYON_API_KEY is set and takes precedence over the stored key.",
  whoami: (email, credits, demo) => `${email} · ${credits} credits${demo ? " · demo mode (placeholder results, no cost)" : ""}`,
  unknownCommand: (cmd) => `Unknown command “${cmd}”. Run \`tevyon help\` for all commands.`,
  missingModel: "Which model? Example: tevyon generate flux_3_image \"a red fox in snow\". `tevyon models` lists them all.",
  unknownModel: (name) => `No model “${name}”. \`tevyon models\` lists all models.`,
  ambiguousModel: (name, options) => `“${name}” matches several models: ${options}.`,
  missingPrompt: "The prompt is missing. Example: tevyon generate flux_3_image \"a red fox in snow\"",
  unknownParam: (name, model, allowed) => `${model} has no option --${name}. Available: ${allowed}.`,
  badValue: (name, value, want) => `--${name} needs ${want}, not “${value}”.`,
  wantNumber: "a number",
  wantInteger: "a whole number",
  wantBoolean: "yes or no",
  missingValue: (name) => `--${name} needs a value.`,
  invalidParams: (issues) => `Invalid settings: ${issues}`,
  price: (model, credits) => `${model}: ${credits} credits`,
  balance: (credits) => `Balance: ${credits} credits`,
  notes: "Prompt hints:",
  notEnough: (credits, balance) => `Not enough credits: the job costs ${credits}, ${balance} are available. Top up in Tevyon Studio.`,
  confirm: (credits) => `Start for ${credits} credits? [y/N] `,
  yes: /^(y|yes)$/i,
  needsYes: (credits) => `This job costs ${credits} credits. Without a terminal, confirm with --yes.`,
  cancelled: "Cancelled, nothing started.",
  consentAsk: (url) => `This job shows real people. Confirm in Tevyon (signed in) that you hold the rights to the pictures and the consent of everyone shown:\n  ${url}\nWaiting for the confirmation …`,
  consentDeclined: "The consent was declined. Nothing started.",
  consentExpired: "The consent request ran out or was used already. Nothing started.",
  consentTimeout: "No confirmation in time. Nothing started; continue later with --consent-id <id>.",
  started: (model, id, credits) => `Started: ${model} · job ${id} · ${credits} credits reserved`,
  later: (id) => `Fetch the result later: tevyon job ${id} --wait`,
  status: { queued: "queued", running: "running", succeeded: "done", failed: "failed" },
  done: (model, seconds) => `Done: ${model} after ${seconds} s`,
  saved: (path) => `Saved: ${path}`,
  failed: (code) => (FAILURES.en as Record<string, string>)[code] ?? "The job failed. All credits were refunded.",
  stillRunning: (id) => `Not done yet. Keep waiting: tevyon job ${id} --wait`,
  retired: (model, successor) => `${model} is no longer available.${successor ? ` Successor: ${successor}.` : ""}`,
  paused: (model) => `${model} is paused right now. Try again later or pick another model.`,
  priceChanged: (credits) => `The price just changed: the job now costs ${credits} credits. Nothing was started or charged. Run the command again.`,
  network: (base) => `Tevyon is not reachable at ${base}.`,
  serverError: (status) => `Tevyon answered with an error (HTTP ${status}). Try again in a moment.`,
  tooMany: (minutes) => `Too many login attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
  keyLimit: (used, limit) => `This key's daily limit is reached: ${used} of ${limit} credits in 24 hours. Raise it in Tevyon Studio → API & MCP.`,
  fileNotFound: (file) => `File not found: ${file}`,
  fileType: (file) => `${file}: start images must be PNG, JPEG or WebP.`,
  fileTooLarge: (file) => `${file} is larger than 10 MB.`,
  noJob: (id) => `No job “${id}” in this account.`,
  ambiguousJob: (id) => `“${id}” matches several jobs. Give more characters of the id.`,
  noJobs: "No jobs yet.",
  noOutputs: "This job has no files.",
  kind: { image: "image", video: "video" },
  modelsHead: ["JOB TYPE", "MODEL", "KIND", "FROM", "DESCRIPTION"],
  runsOut: "retiring",
  pausedTag: "paused",
  jobsHead: ["ID", "MODEL", "STATUS", "CREDITS", "CREATED", "PROMPT"],
  credits: (n) => (n === null ? "–" : `${n} cr`),
  creditsSummary: (s) => `Available ${s.available} · reserved ${s.reserved} · spent ${s.spent} · refunded ${s.refunded} · granted ${s.granted}`,
  creditsHead: ["DATE", "MOVEMENT", "CHANNEL", "CREDITS", "BALANCE"],
  grant: { welcome: "Welcome credits", purchase: "Purchase", subscription: "Plan credits", adjustment: "Adjustment" },
  charge: { reserved: "reserved", charged: "charged", refunded: "refunded" },
  reversal: { refund: "Refund", dispute: "Payment dispute", dispute_won: "Dispute won" },
  expiry: "Plan credits expired",
  expiring: (credits, until) => `of which ${credits} plan credits until ${until}, spent first`,
  origin: { web: "Studio", mcp: "MCP", cli: "CLI", api: "API" },
  noEntries: "No movements yet.",
  mcp: (endpoint, keyCmd) => [
    `Connect Tevyon as an MCP server. Endpoint: ${endpoint}`,
    "",
    "Claude Code, signing in through the browser (all projects):",
    `  claude mcp add --transport http --scope user tevyon ${endpoint}`,
    "",
    "Claude Code with your API key:",
    `  claude mcp add --transport http --scope user tevyon ${endpoint} \\`,
    `    --header "Authorization: Bearer ${keyCmd}"`,
    "",
    "Cursor, Windsurf and others (mcp.json):",
    `  { "mcpServers": { "tevyon": { "url": "${endpoint}", "headers": { "Authorization": "Bearer <your key>" } } } }`,
    "",
    "The client stores the key in its own configuration. You can revoke it any time in Tevyon Studio → API & MCP.",
  ].join("\n"),
  help: `Tevyon CLI: images and videos with leading models, the price before every job.

Usage: tevyon <command> [options]

Account
  login                       Sign in through the browser: confirm a code in Tevyon Studio
  login --with-key            Paste an existing API key (hidden) or pass it on stdin
  login --key <key>           Give the key directly (ends up in the shell history)
  logout                      Remove the key from this machine
  whoami                      Account and balance
  credits [--limit <n>] [--csv]
                              Statement: available, reserved, spent, every movement

Create
  models [--kind image|video] Models with job type and starting price
  price <model> [prompt] [--<param> <value> …]
                              Price in credits and prompt hints. Free.
  generate <model> <prompt> [--<param> <value> …]
                              Start a job (price shown first), wait, save the files.
      --yes                   start without asking (required without a terminal)
      --out <dir>             folder for the files (default: current folder)
      --no-wait               start only, do not wait
      --exact                 send your own finished prompt unchanged (else Tevyon writes it)
      --based-on <job-id>     build a final on a draft (reuses its prompt)
      --consent-id <id>       Face/Character Swap: use a consent confirmed already
      --image <file>          start image (image → video): a local file is uploaded first
      --timeout <seconds>     wait at most this long (default 1200)
  jobs [--limit <n>] [--status <status>]
                              Recent jobs
  job <id> [--wait] [--download] [--out <dir>]
                              A job's status; optionally wait and download its files
  upload <file>               Upload an image, prints the path for --image

Agents
  mcp                         Connect Tevyon as an MCP server in Claude Code, Cursor & co.

General
  --json                      machine-readable output on stdout (for scripts and agents)
  --url <address>             Tevyon server (default: TEVYON_URL or http://localhost:3100)
  -h, --help · -v, --version

\`tevyon models --json\` shows each model's parameters. Examples:
  tevyon generate flux_3_image "a red fox in snow" --aspect-ratio 16:9
  tevyon generate veo_3_1_lite "tracking shot through a misty forest" --duration 8 --yes`,
};

export function messages(lang: Lang): Messages {
  return lang === "de" ? de : en;
}

export type { Messages };
