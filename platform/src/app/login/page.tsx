import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import "./login.css";

export const metadata: Metadata = { title: "Sign in – Tevyon" };

// Our own examples from the image studio wall (gallery-data.ts, GPT Image 2, full size), as a still, dense wall like
// the studio's: no drift, no clips. [src, width, height]; the sizes keep the columns from jumping while they load.
type Still = [string, number, number];
const g = (name: string, w: number, h: number): Still => [`/gallery/${name}.webp`, w, h];
const COLUMNS: Still[][] = [
  [g("n-fashion-duene", 1024, 1536), g("n-film-jazzbar", 1672, 941), g("n-places-medina", 941, 1672), g("n-people-gitarrist", 1086, 1448)],
  [g("n-fashion-trench", 941, 1672), g("n-film-kriegerin", 1672, 941), g("n-people-dachterrasse", 941, 1672), g("n-places-kirschbluete", 1024, 1536)],
  [g("n-fashion-street", 1086, 1448), g("n-places-hongkong", 941, 1672), g("n-film-mondbasis", 1672, 941), g("n-fashion-regenmantel", 941, 1672)],
];

/**
 * Login, reduced to what it needs: a still wall of our pictures on the left, on the right the wordmark, one title,
 * the e-mail field and one action (login-form.tsx). Light like the studio; colour only comes from the pictures.
 */
export default function LoginPage() {
  return (
    <main className="login">
      <section className="login__art" aria-hidden="true">
        {COLUMNS.map((col, i) => (
          <div className="login__col" key={i}>
            {col.map(([src, w, h]) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} width={w} height={h} alt="" decoding="async" />
            ))}
          </div>
        ))}
      </section>

      <section className="login__panel">
        <header className="login__top">
          <span className="login__wordmark" role="img" aria-label="Tevyon" />
        </header>
        <LoginForm />
      </section>
    </main>
  );
}
