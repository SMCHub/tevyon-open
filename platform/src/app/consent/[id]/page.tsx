import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { catalog } from "@/core/catalog";
import { currentAccount } from "@/server/account";
import { runtime } from "@/server/runtime";
import { ConsentDecision } from "./consent-decision";
import "../../login/login.css";
import "../../oauth/oauth.css";
import "../consent.css";

export const metadata: Metadata = { title: "Einwilligung bestätigen – Tevyon", robots: { index: false, follow: false } };

/** What the second picture is, per job type (none of the current job types needs a consent; add yours here). */
const SECOND: Record<string, string> = {};

/**
 * A person confirms that an agent may start a job that shows real people from pictures, signed in to
 * Tevyon: they see both pictures and declare the rights and the consent of everyone shown (core/consent.ts). The
 * proxy sends signed-out visitors to the login and back here.
 */
export default async function Page({ params }: PageProps<"/consent/[id]">) {
  const { id } = await params;
  const account = await currentAccount();
  if (!account) notFound();
  const view = await (await runtime()).consent.view(account.id, id);
  if (!view) notFound();
  const model = catalog.get(view.jobType)?.model ?? view.jobType;
  return (
    <main className="grant">
      <section className="auth grant__card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="auth__mark" src="/favicon.svg" alt="" />
        <div className="auth__step">
          <p className="grant__eyebrow">Einwilligung bestätigen</p>
          <h1 className="auth__title grant__title">Ein Agent möchte einen {model} erstellen</h1>
          <p className="auth__lead">Angemeldet als <strong>{account.email ?? "dein Konto"}</strong>.</p>
          <div className="consent__pair">
            {view.images.map((src, i) => (
              <figure key={src}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={i === 0 ? "Zielbild" : SECOND[view.jobType] ?? "Zweites Bild"} />
                <figcaption>{i === 0 ? "Zielbild" : SECOND[view.jobType] ?? "Zweites Bild"}</figcaption>
              </figure>
            ))}
          </div>
          <p className="auth__hint">
            Mit «Bestätigen» erklärst du: Du hast die Rechte an beiden Bildern und die Einwilligung aller abgebildeten
            Personen. Die Bestätigung gilt einmal, für genau diese Bilder, und läuft nach zwei Stunden ab.
          </p>
          <ConsentDecision id={view.id} state={view.state} />
        </div>
      </section>
    </main>
  );
}
