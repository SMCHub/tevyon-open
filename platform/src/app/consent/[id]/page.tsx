import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { catalog } from "@/core/catalog";
import { currentAccount } from "@/server/account";
import { runtime } from "@/server/runtime";
import { ConsentDecision } from "./consent-decision";
import "../../login/login.css";
import "../../oauth/oauth.css";
import "../consent.css";

export const metadata: Metadata = { title: "Confirm consent – Tevyon", robots: { index: false, follow: false } };

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
          <p className="grant__eyebrow">Confirm consent</p>
          <h1 className="auth__title grant__title">An agent wants to create a {model}</h1>
          <p className="auth__lead">Signed in as <strong>{account.email ?? "your account"}</strong>.</p>
          <div className="consent__pair">
            {view.images.map((src, i) => (
              <figure key={src}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={i === 0 ? "Target image" : SECOND[view.jobType] ?? "Second image"} />
                <figcaption>{i === 0 ? "Target image" : SECOND[view.jobType] ?? "Second image"}</figcaption>
              </figure>
            ))}
          </div>
          <p className="auth__hint">
            By choosing “Confirm” you declare that you hold the rights to both images and the consent of everyone
            shown. The confirmation applies once, to exactly these images, and expires after two hours.
          </p>
          <ConsentDecision id={view.id} state={view.state} />
        </div>
      </section>
    </main>
  );
}
