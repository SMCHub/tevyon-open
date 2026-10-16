import type { Metadata } from "next";
import { ProfilePage } from "./profile-page";
import "./profile.css";

export const metadata: Metadata = { title: "Profil – Tevyon" };

/** The account's own profile: who you are in the community, what you used, your creations and what of them is public. */
export default function Page() {
  return <ProfilePage />;
}
