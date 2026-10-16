import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { redirect } from "next/navigation";
import { currentAccount } from "@/server/account";
import { loadAccessOverview } from "@/server/access-overview-load";
import { pageOrigin } from "@/server/consent";
import { AgentConsole } from "./agent-console";
import "./agent-console.css";

/** Self-hosted at build time like every next/font, so no request goes to Google from the browser. */
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono-console", display: "swap" });

export const metadata: Metadata = { title: "API & MCP – Tevyon" };

/** The "API & MCP" console. Rendered with the account's keys and the agents' latest jobs, then kept current in the browser. */
export default async function ApiPage() {
  const account = await currentAccount();
  if (!account || account.via !== "session") redirect("/login?next=/settings/api");
  const [origin, initial] = await Promise.all([pageOrigin(), loadAccessOverview(account.id)]);
  return <AgentConsole className={mono.variable} origin={origin} initial={initial} now={Date.now()} />;
}
