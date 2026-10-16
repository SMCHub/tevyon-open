"use client";

import { useEffect, useRef } from "react";
import { Minus, Play, Plus, SlidersHorizontal, X } from "lucide-react";
import { NotEnough } from "@/components/studio/credits";
import { GpConsent, GpFooter, GpPrompt } from "@/components/studio/gen-panel";
import type { BuilderState } from "./builder";
import { ratioOf, wishField, type Category, type Product, type Style, type WishRole } from "./data";
import { CATEGORY_ICON } from "./sidebar";
import { AvatarSlot, ProductSlot, type ResultPick } from "./slots";
import { AspectBox, Cover, TemplateCard } from "./templates";

const QUESTION: Record<WishRole, string> = {
  spoken: "What does the person say?",
  lettering: "Lettering in the image",
  describe: "What is the product?",
  wish: "What should be different?",
};

const FLOW_LINE: Record<string, string> = {
  product_shots: "Your product in exactly this look.",
  product_shots_people: "Your product with a model in this look.",
  ads: "A finished ad with your product and your lettering.",
  poster: "A poster in this style, with your product or only from your description.",
  marketplace: "A shop image with your product, ready for the marketplace.",
  motion: "Your product in motion, with sound.",
  ugc: "A person holds your product and says your line: first the still, then it speaks.",
};

type Props = {
  template: Style;
  base: Style | null;
  category: Category | undefined;
  more: Style[];
  onMore: (s: Style) => void;
  onEditor: () => void;
  onClose: () => void;
  state: BuilderState;
  onState: (patch: Partial<BuilderState>) => void;
  products: Product[];
  product: Product | null;
  productImage: string | null;
  onProduct: (id: string | null) => void;
  onUpload: (f: File | string) => Promise<void>;
  onImport: (p: Omit<Product, "id" | "pick">) => Product;
  onManageProducts: () => void;
  results: ResultPick[];
  onResult: (jobId: string) => Promise<string | null>;
  onError: (e: string) => void;
  error: string | null;
  missing: string | null;
  price: number | null;
  priceState: "idle" | "loading" | "error";
  balance: number | null;
  tooExpensive: boolean;
  busy: boolean;
  canGo: boolean;
  onGenerate: () => void;
};

/**
 * A template opened to recreate it: the template large, next to it only what it needs (the product, a person where the
 * style has one, one text), its price and one button; more of its kind below. It shares the builder's state, so
 * “Open in the editor” goes on with everything set here.
 */
export function TemplateDialog(p: Props) {
  const { template: t, state } = p;
  const panel = useRef<HTMLDivElement>(null);
  // The page re-renders behind the dialog (job polling): a new onClose must not re-run the effect and move the focus.
  const close = useRef(p.onClose);
  close.current = p.onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // The panel takes the focus (Tab then walks the dialog), so no field lights up before anyone touched it.
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // A menu inside (product picker) closes first; it handles Escape itself.
      if (e.key === "Escape" && !panel.current?.querySelector(".ms-menu")) close.current();
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, input:not([type=file]), a[href]")];
        const first = f[0], last = f.at(-1);
        const at = document.activeElement;
        if (e.shiftKey && (at === first || at === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && at === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus({ preventScroll: true });
    };
  }, []);
  // “More like this” swaps the template: start at the top again.
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [t.id]);

  const field = wishField(t, Boolean(p.productImage));
  const total = p.price !== null ? p.price * state.count : null;
  const durations = t.duration ? t.duration.steps ?? Array.from({ length: t.duration.max - t.duration.min + 1 }, (_, i) => t.duration!.min + i) : [];
  const showSlots = t.product !== "none" || t.avatar !== "none";

  return (
    <div className="ms-dialog ma-tdlg" role="dialog" aria-modal="true" aria-labelledby="ma-tdlg-title" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="ma-tdlg__panel" ref={panel} tabIndex={-1}>
        <button type="button" className="icon-btn ma-tdlg__close" onClick={p.onClose} aria-label="Close"><X /></button>
        <div className="ma-tdlg__main">
          <figure className="ma-tdlg__media" style={{ aspectRatio: t.coverShape.replace(":", " / "), "--r": ratioOf(t.coverShape) } as React.CSSProperties}>
            <Cover key={t.id} src={t.cover} alt={t.title} eager />
            {t.kind === "video" && <span className="ma-tpl__kind ma-tdlg__kind"><Play aria-hidden="true" />Video</span>}
          </figure>

          <div className="ma-tdlg__form">
            <header className="ma-tdlg__head">
              <span className="ma-kicker">{CATEGORY_ICON[t.category]}{t.base ? "Template" : "Style"} · {p.category?.label ?? t.category} · {t.kind === "video" ? "Video" : "Image"}</span>
              <h2 id="ma-tdlg-title" className="ma-tdlg__title">{t.title}</h2>
              <p className="ma-tdlg__sub">{FLOW_LINE[t.flow] ?? "Your product in this look."}{p.base ? <> Style: {p.base.title}.</> : null}</p>
            </header>

            {showSlots && (
              <div className="ma-tdlg__block">
                <span className="ma-tdlg__label">
                  {t.avatar !== "none" ? "Your product and the person" : "Your product"}
                  <em>{t.product === "required" ? "required" : "optional"}</em>
                </span>
                <div className="ma-slots">
                  {t.product !== "none" && (
                    <ProductSlot
                      products={p.products}
                      product={p.product}
                      image={p.productImage}
                      onChoose={p.onProduct}
                      onUpload={p.onUpload}
                      onImport={p.onImport}
                      onClear={() => p.onProduct(null)}
                      onManage={p.onManageProducts}
                      results={p.results}
                      onResult={p.onResult}
                    />
                  )}
                  {t.avatar !== "none" && (
                    <AvatarSlot url={state.avatar} onUrl={(u) => p.onState({ avatar: u, consent: false })} onError={p.onError} required={t.avatar === "required"} />
                  )}
                </div>
              </div>
            )}

            <div className="ma-tdlg__block">
              <span className="ma-tdlg__label">{QUESTION[field.role]}<em>{field.required ? "required" : "optional"}</em></span>
              <GpPrompt value={state.wish} onChange={(v) => p.onState({ wish: v })} placeholder={field.placeholder} onSubmit={p.onGenerate} max={field.max} rows={3} />
            </div>

            {(t.aspects.length > 1 || durations.length > 0 || t.batch) && (
              <div className="ma-tdlg__block ma-tdlg__settings">
                {t.aspects.length > 1 && (
                  <div className="ma-setting">
                    <span className="ma-setting__label">Format</span>
                    <div className="ma-aspects" role="radiogroup" aria-label="Format">
                      {t.aspects.map((a) => (
                        <button key={a} type="button" role="radio" aria-checked={state.aspect === a} className={`ma-aspect ma-aspect--num${state.aspect === a ? " is-on" : ""}`} onClick={() => p.onState({ aspect: a })}>
                          <AspectBox value={a} size={14} /><span>{a}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {durations.length > 0 && (
                  <div className="ma-setting">
                    <span className="ma-setting__label">Length</span>
                    <div className="ma-aspects" role="radiogroup" aria-label="Length">
                      {durations.map((d) => (
                        <button key={d} type="button" role="radio" aria-checked={state.duration === d} className={`ma-aspect ma-aspect--num${state.duration === d ? " is-on" : ""}`} onClick={() => p.onState({ duration: d })}>
                          {d} s
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {t.batch && (
                  <div className="ma-setting ma-setting--row">
                    <span className="ma-setting__label">Count</span>
                    <span className="ms-stepper" role="group" aria-label="Count">
                      <button type="button" onClick={() => p.onState({ count: Math.max(1, state.count - 1) })} disabled={state.count <= 1} aria-label="Fewer"><Minus /></button>
                      <span aria-live="polite">{state.count}/4</span>
                      <button type="button" onClick={() => p.onState({ count: Math.min(4, state.count + 1) })} disabled={state.count >= 4} aria-label="More"><Plus /></button>
                    </span>
                  </div>
                )}
              </div>
            )}

            {t.avatar !== "none" && state.avatar && (
              <GpConsent checked={state.consent} onChange={(v) => p.onState({ consent: v })}>I am the person in the avatar photo or have their consent.</GpConsent>
            )}

            <GpFooter
              label={t.chain ? "Recreate: still + video" : "Recreate"}
              busy={p.busy}
              missing={p.missing}
              price={p.priceState === "idle" ? total : null}
              priceHint={p.priceState === "loading" ? "…" : p.priceState === "error" ? "no price" : "–"}
              disabled={!p.canGo}
              onGo={p.onGenerate}
              title={p.missing ?? "Recreate"}
              notice={p.error ? <p className="note note--error" role="alert">{p.error}</p> : p.tooExpensive ? <NotEnough need={total ?? 0} have={p.balance ?? 0} /> : null}
            />
            <button type="button" className="ma-tdlg__editor" onClick={p.onEditor}><SlidersHorizontal aria-hidden="true" /> Open in the editor, with every setting</button>
          </div>
        </div>

        {p.more.length > 0 && (
          <section className="ma-tdlg__more" aria-labelledby="ma-tdlg-more">
            <h3 id="ma-tdlg-more">More like this</h3>
            <div className="ma-grid ma-tdlg__grid">
              {p.more.map((m) => <TemplateCard key={m.id} s={m} on={false} eager={false} onUse={p.onMore} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
