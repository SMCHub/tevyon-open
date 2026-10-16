import type { Metadata } from "next";
import { PresetRun } from "./preset-run";

export const metadata: Metadata = { title: "Preset – Tevyon" };

export default async function PresetPage({ params }: PageProps<"/presets/[id]">) {
  const { id } = await params;
  return <PresetRun id={id} />;
}
