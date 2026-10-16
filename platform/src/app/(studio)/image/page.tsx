import type { Metadata } from "next";
import { Suspense } from "react";
import { ImageStudio } from "./image-studio";

export const metadata: Metadata = { title: "Bild – Tevyon" };

export default function ImagePage() {
  return (
    <Suspense>
      <ImageStudio />
    </Suspense>
  );
}
