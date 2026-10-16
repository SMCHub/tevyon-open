import type { Metadata } from "next";
import { Director } from "./director";

export const metadata: Metadata = { title: "Director – Tevyon" };

export default function DirectorPage() {
  return <Director />;
}
