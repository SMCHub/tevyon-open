import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentAccount } from "@/server/account";
import { isOperator } from "@/server/community";
import { ModerationPage } from "./moderation-page";

export const metadata: Metadata = { title: "Moderation – Tevyon", robots: { index: false, follow: false } };

/** The operator's queue of reported and hidden creations and profiles (OPERATOR_EMAILS). Everyone else gets a 404. */
export default async function Page() {
  if (!isOperator(await currentAccount())) notFound();
  return <ModerationPage />;
}
