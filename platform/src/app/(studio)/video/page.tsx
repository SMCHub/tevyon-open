import type { Metadata } from "next";
import { Suspense } from "react";
import { VideoStudio } from "./video-studio";

export const metadata: Metadata = { title: "Video – Tevyon" };

export default function VideoPage() {
  return (
    <Suspense>
      <VideoStudio />
    </Suspense>
  );
}
