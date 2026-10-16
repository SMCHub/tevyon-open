import { redirect } from "next/navigation";

/** The studio starts in the image studio. */
export default function StudioHome() {
  redirect("/image");
}
