import type { Metadata } from "next";
import { Suspense } from "react";
import { VideoToolsStudio } from "./video-tools-studio";

export const metadata: Metadata = { title: "Video tools – Tevyon" };

export default function VideoToolsPage() {
  return (
    <Suspense>
      <VideoToolsStudio />
    </Suspense>
  );
}
