import type { Metadata } from "next";
import { Suspense } from "react";
import { ToolsStudio } from "./tools-studio";

export const metadata: Metadata = { title: "Cutout and Upscale – Tevyon" };

export default function ToolsPage() {
  return (
    <Suspense>
      <ToolsStudio />
    </Suspense>
  );
}
