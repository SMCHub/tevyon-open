"use client";

import { useRef, useState } from "react";
import { Braces, Globe, MonitorPlay, SquareTerminal, Workflow } from "lucide-react";
import type { AccessKey } from "@/server/access-overview";
import { CodeBlock, maskKey, RelativeTime } from "./console-parts";

type Target = "claude-code" | "claude-ai" | "cursor" | "cli" | "rest";

const TABS: { id: Target; label: string; icon: React.ReactNode }[] = [
  { id: "claude-code", label: "Claude Code", icon: <SquareTerminal /> },
  { id: "claude-ai", label: "claude.ai", icon: <Globe /> },
  { id: "cursor", label: "Cursor", icon: <MonitorPlay /> },
  { id: "cli", label: "CLI", icon: <Workflow /> },
  { id: "rest", label: "REST", icon: <Braces /> },
];

/** Which key or app already connects this client, judged by its name (apps name themselves at registration). */
function connectionOf(target: Target, keys: AccessKey[]): AccessKey | undefined {
  switch (target) {
    case "claude-code":
      return keys.find((k) => /claude code/i.test(k.name));
    case "claude-ai":
      return keys.find((k) => k.kind === "oauth" && /claude/i.test(k.name) && !/code/i.test(k.name));
    case "cursor":
      return keys.find((k) => /cursor/i.test(k.name));
    case "cli":
      return keys.find((k) => /\bcli\b/i.test(k.name));
    default:
      return undefined;
  }
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="ac-step">
      <span className="ac-step__n" aria-hidden="true">{n}</span>
      <div className="ac-step__body">
        <p className="ac-step__title">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Status({ con }: { con: AccessKey | undefined }) {
  if (!con) return <p className="ac-status" data-on="false"><i aria-hidden="true" /><span>Noch nicht verbunden</span></p>;
  return (
    <p className="ac-status" data-on="true">
      <i aria-hidden="true" />
      <span>
        Verbunden als «{con.name}»{con.lastUsedAt ? <> · zuletzt aktiv <RelativeTime ms={con.lastUsedAt} /></> : " · noch nie benutzt"}
      </span>
    </p>
  );
}

/**
 * How to connect each client, as numbered steps with copyable commands. A key created a moment ago fills the variants
 * with a key: shown masked, copied in full. Otherwise the commands read the CLI's key from the keychain.
 */
export function ConnectTabs({ origin, keys, freshKey }: { origin: string; keys: AccessKey[]; freshKey?: string | undefined }) {
  const [tab, setTab] = useState<Target>("claude-code");
  const list = useRef<HTMLDivElement>(null);
  const endpoint = `${origin}/api/mcp`;
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  const fromKeychain = `$(security find-generic-password -s 'Tevyon CLI' -a '${origin}' -w)`;
  const keyShown = freshKey ? maskKey(freshKey) : fromKeychain;
  const keyCopied = freshKey ?? fromKeychain;
  const withKey = (key: string) => `claude mcp add --transport http --scope user tevyon ${endpoint} \\\n  --header "Authorization: Bearer ${key}"`;
  const cursorWithKey = (key: string) => JSON.stringify({ mcpServers: { tevyon: { url: endpoint, headers: { Authorization: `Bearer ${key}` } } } }, null, 2);
  const index = TABS.findIndex((t) => t.id === tab);

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = TABS[(index + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    setTab(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  }

  return (
    <div className="ac-connect">
      <div className="ac-tabs" role="tablist" aria-label="Client wählen" ref={list} onKeyDown={onKey} style={{ "--i": index, "--n": TABS.length } as React.CSSProperties}>
        <span className="ac-tabs__glow" aria-hidden="true" />
        {TABS.map((t) => {
          const on = Boolean(connectionOf(t.id, keys));
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              data-tab={t.id}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="ac-tabs__tab"
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
              {on && (
                <>
                  <i className="ac-tabs__dot" aria-hidden="true" />
                  <span className="ac-sr">, verbunden</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div className="ac-tabpanel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} key={tab}>
        {tab === "claude-code" && (
          <>
            <Status con={connectionOf("claude-code", keys)} />
            <ol className="ac-steps">
              <Step n={1} title="Server hinzufügen">
                <CodeBlock code={`claude mcp add --transport http --scope user tevyon ${endpoint}`} label="Befehl für Claude Code kopieren" />
              </Step>
              <Step n={2} title="Im Browser anmelden">
                <p>In Claude Code <code>/mcp</code> öffnen, «tevyon» wählen und «Authenticate». Tevyon öffnet sich, du erlaubst den Zugriff.</p>
              </Step>
              <Step n={3} title="Loslegen">
                <p>Zum Beispiel: «Erstelle mit Tevyon ein Kinobild, Tokio bei Regen, 16:9.» Claude nennt dir den Preis, bevor etwas startet.</p>
              </Step>
            </ol>
            <details className="ac-alt">
              <summary>Lieber mit API-Schlüssel statt Browser-Login</summary>
              <CodeBlock code={withKey(keyShown)} copy={withKey(keyCopied)} label="Befehl mit Schlüssel kopieren" />
            </details>
          </>
        )}

        {tab === "claude-ai" && (
          <>
            <Status con={connectionOf("claude-ai", keys)} />
            {local && <p className="ac-notice">claude.ai erreicht nur öffentliche HTTPS-Adressen. Mit <code>{origin}</code> geht das noch nicht, nach dem Deploy schon.</p>}
            <ol className="ac-steps">
              <Step n={1} title="Connector anlegen">
                <p>In claude.ai oder Claude Desktop: Einstellungen → Connectors → «Benutzerdefinierten Connector hinzufügen».</p>
              </Step>
              <Step n={2} title="Adresse eintragen">
                <CodeBlock code={endpoint} label="MCP-Adresse kopieren" />
              </Step>
              <Step n={3} title="Verbinden und erlauben">
                <p>Claude öffnet Tevyon zur Anmeldung, du erlaubst den Zugriff. Danach erscheint die Verbindung hier als App.</p>
              </Step>
            </ol>
          </>
        )}

        {tab === "cursor" && (
          <>
            <Status con={connectionOf("cursor", keys)} />
            <ol className="ac-steps">
              <Step n={1} title="In ~/.cursor/mcp.json eintragen">
                <CodeBlock lang="json" code={JSON.stringify({ mcpServers: { tevyon: { url: endpoint } } }, null, 2)} label="MCP-Konfiguration kopieren" />
              </Step>
              <Step n={2} title="Anmelden">
                <p>Beim ersten Aufruf fragt Cursor nach der Anmeldung im Browser. Windsurf und VS Code funktionieren gleich.</p>
              </Step>
            </ol>
            <details className="ac-alt">
              <summary>Mit API-Schlüssel im Header</summary>
              <CodeBlock lang="json" code={cursorWithKey(freshKey ? maskKey(freshKey) : "<dein Schlüssel>")} copy={cursorWithKey(freshKey ?? "<dein Schlüssel>")} label="Konfiguration mit Schlüssel kopieren" />
            </details>
          </>
        )}

        {tab === "cli" && (
          <>
            <Status con={connectionOf("cli", keys)} />
            <ol className="ac-steps">
              <Step n={1} title="Installieren">
                <CodeBlock code="cd cli && npm install && npm link" label="Installationsbefehl kopieren" />
                <p className="ac-hint">Bald als npm-Paket. Node 22.18 oder neuer.</p>
              </Step>
              <Step n={2} title="Anmelden">
                <CodeBlock code="tevyon login" label="Login-Befehl kopieren" />
                <p className="ac-hint">Die CLI zeigt einen Code und öffnet Tevyon im Browser. Du bestätigst, die CLI bekommt ihren eigenen Schlüssel.</p>
              </Step>
              <Step n={3} title="Erstellen">
                <CodeBlock code={`tevyon generate flux_3_image "Tokio bei Regen, Neonlicht" --aspect-ratio 16:9`} label="Beispiel kopieren" />
              </Step>
            </ol>
          </>
        )}

        {tab === "rest" && (
          <>
            <p className="ac-status" data-on="neutral"><i aria-hidden="true" /><span>Dieselbe Job-API wie Studio, MCP und CLI</span></p>
            <ol className="ac-steps">
              <Step n={1} title="Modelle und Preise">
                <CodeBlock code={`curl ${origin}/api/catalog`} label="Befehl kopieren" />
              </Step>
              <Step n={2} title="Job starten">
                <CodeBlock
                  code={`curl -X POST ${origin}/api/jobs/flux_3_image \\\n  -H "Authorization: Bearer $TEVYON_API_KEY" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '{"params":{"prompt":"Tokio bei Regen"},"maxCredits":7}'`}
                  label="Befehl kopieren"
                />
              </Step>
              <Step n={3} title="Status abfragen">
                <CodeBlock code={`curl -H "Authorization: Bearer $TEVYON_API_KEY" "${origin}/api/jobs?ids=<job-id>"`} label="Befehl kopieren" />
              </Step>
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
