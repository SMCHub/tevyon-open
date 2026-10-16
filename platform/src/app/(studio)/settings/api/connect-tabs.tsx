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
  if (!con) return <p className="ac-status" data-on="false"><i aria-hidden="true" /><span>Not connected yet</span></p>;
  return (
    <p className="ac-status" data-on="true">
      <i aria-hidden="true" />
      <span>
        Connected as “{con.name}”{con.lastUsedAt ? <> · last active <RelativeTime ms={con.lastUsedAt} /></> : " · never used"}
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
      <div className="ac-tabs" role="tablist" aria-label="Choose a client" ref={list} onKeyDown={onKey} style={{ "--i": index, "--n": TABS.length } as React.CSSProperties}>
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
                  <span className="ac-sr">, connected</span>
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
              <Step n={1} title="Add the server">
                <CodeBlock code={`claude mcp add --transport http --scope user tevyon ${endpoint}`} label="Copy command for Claude Code" />
              </Step>
              <Step n={2} title="Sign in in the browser">
                <p>In Claude Code, open <code>/mcp</code>, choose “tevyon” and “Authenticate”. Tevyon opens and you allow access.</p>
              </Step>
              <Step n={3} title="Get started">
                <p>For example: “Use Tevyon to make a cinematic still, Tokyo in the rain, 16:9.” Claude tells you the price before anything starts.</p>
              </Step>
            </ol>
            <details className="ac-alt">
              <summary>Use an API key instead of the browser login</summary>
              <CodeBlock code={withKey(keyShown)} copy={withKey(keyCopied)} label="Copy command with key" />
            </details>
          </>
        )}

        {tab === "claude-ai" && (
          <>
            <Status con={connectionOf("claude-ai", keys)} />
            {local && <p className="ac-notice">claude.ai only reaches public HTTPS addresses. <code>{origin}</code> does not work yet; after the deploy it will.</p>}
            <ol className="ac-steps">
              <Step n={1} title="Add a connector">
                <p>In claude.ai or Claude Desktop: Settings → Connectors → “Add custom connector”.</p>
              </Step>
              <Step n={2} title="Enter the address">
                <CodeBlock code={endpoint} label="Copy MCP address" />
              </Step>
              <Step n={3} title="Connect and allow">
                <p>Claude opens Tevyon to sign in and you allow access. The connection then shows up here as an app.</p>
              </Step>
            </ol>
          </>
        )}

        {tab === "cursor" && (
          <>
            <Status con={connectionOf("cursor", keys)} />
            <ol className="ac-steps">
              <Step n={1} title="Add to ~/.cursor/mcp.json">
                <CodeBlock lang="json" code={JSON.stringify({ mcpServers: { tevyon: { url: endpoint } } }, null, 2)} label="Copy MCP configuration" />
              </Step>
              <Step n={2} title="Sign in">
                <p>On first use, Cursor asks you to sign in in the browser. Windsurf and VS Code work the same way.</p>
              </Step>
            </ol>
            <details className="ac-alt">
              <summary>With an API key in the header</summary>
              <CodeBlock lang="json" code={cursorWithKey(freshKey ? maskKey(freshKey) : "<your key>")} copy={cursorWithKey(freshKey ?? "<your key>")} label="Copy configuration with key" />
            </details>
          </>
        )}

        {tab === "cli" && (
          <>
            <Status con={connectionOf("cli", keys)} />
            <ol className="ac-steps">
              <Step n={1} title="Install">
                <CodeBlock code="cd cli && npm install && npm link" label="Copy install command" />
                <p className="ac-hint">Soon as an npm package. Node 22.18 or newer.</p>
              </Step>
              <Step n={2} title="Sign in">
                <CodeBlock code="tevyon login" label="Copy login command" />
                <p className="ac-hint">The CLI shows a code and opens Tevyon in the browser. You confirm, and the CLI gets its own key.</p>
              </Step>
              <Step n={3} title="Create">
                <CodeBlock code={`tevyon generate flux_3_image "Tokyo in the rain, neon light" --aspect-ratio 16:9`} label="Copy example" />
              </Step>
            </ol>
          </>
        )}

        {tab === "rest" && (
          <>
            <p className="ac-status" data-on="neutral"><i aria-hidden="true" /><span>The same job API as the studio, MCP and CLI</span></p>
            <ol className="ac-steps">
              <Step n={1} title="Models and prices">
                <CodeBlock code={`curl ${origin}/api/catalog`} label="Copy command" />
              </Step>
              <Step n={2} title="Start a job">
                <CodeBlock
                  code={`curl -X POST ${origin}/api/jobs/flux_3_image \\\n  -H "Authorization: Bearer $TEVYON_API_KEY" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d '{"params":{"prompt":"Tokyo in the rain"},"maxCredits":7}'`}
                  label="Copy command"
                />
              </Step>
              <Step n={3} title="Check the status">
                <CodeBlock code={`curl -H "Authorization: Bearer $TEVYON_API_KEY" "${origin}/api/jobs?ids=<job-id>"`} label="Copy command" />
              </Step>
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
