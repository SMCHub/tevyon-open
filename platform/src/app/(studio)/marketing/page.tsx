import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketingAgent } from "./marketing-agent";

export const metadata: Metadata = { title: "Marketing Agent – Tevyon" };

export default function MarketingPage() {
  return (
    <Suspense>
      <MarketingAgent />
    </Suspense>
  );
}
