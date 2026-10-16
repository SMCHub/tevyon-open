import type { Metadata } from "next";
import { PresetsPage } from "./presets-page";

export const metadata: Metadata = { title: "Presets – Tevyon" };

export default function Page() {
  return <PresetsPage />;
}
