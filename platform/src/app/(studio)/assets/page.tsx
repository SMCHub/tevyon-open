import type { Metadata } from "next";
import { Assets } from "./assets";

export const metadata: Metadata = { title: "Assets – Tevyon" };

export default function AssetsPage() {
  return <Assets />;
}
