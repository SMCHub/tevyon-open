import type { Metadata } from "next";
import { Suspense } from "react";
import { CreditsPage } from "./credits-page";

export const metadata: Metadata = { title: "Credits – Tevyon" };

export default function Page() {
  return (
    <Suspense>
      <CreditsPage />
    </Suspense>
  );
}
