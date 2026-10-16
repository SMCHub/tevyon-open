"use client";

import { useState } from "react";
import { Check, ImageUp, Minus, Plus, X } from "lucide-react";
import { NotEnough } from "@/components/studio/credits";
import { GpConsent, GpFooter, GpModes, GpPrompt, GpSettings, GpStep } from "@/components/studio/gen-panel";
import { uploadImage } from "@/components/studio/upload";
import { useMediaPicker } from "@/components/studio/media-picker";
import { wishField, type AdRef, type Category, type Kind, type Product, type Style, type WishRole } from "./data";
import { GAgent, GArrow, GImage, GVideo } from "./icons";
import { AvatarSlot, ProductSlot, type ResultPick } from "./slots";
import { AspectBox, Cover } from "./templates";

const TEXT_TITLE: Record<WishRole, string> = { spoken: "Spoken sentence", lettering: "Lettering in the image", describe: "Description", wish: "Wish" };

export type BuilderState = {
  wish: string; aspect: string | null; duration: number | null; count: number;
  avatar: string | null; adRef: string | null; consent: boolean;
};

type Props = {
  categories: Category[];
  category: string;
  onCategory: (id: string) => void;
  style: Style | null;
  base: Style | null;
  kind: Kind;
  onKind: (k: Kind) => void;
  onStyleDialog: () => void;
  onAgent: () => void;
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
  refs: AdRef[];
  onAddRef: (r: AdRef) => void;
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
 * The Marketing Agent's builder, in the Studio's own panel language (numbered steps, folded settings, sticky footer
 * with price): style, product and avatar, text, ad reference, settings, then Generate.
 */
export function Builder(p: Props) {
  const { style, state } = p;
  const field = style ? wishField(style, Boolean(p.productImage)) : null;
  const needsWish = field?.required ?? false;
  const textTitle = TEXT_TITLE[field?.role ?? "wish"];
  const total = p.price !== null ? p.price * state.count : null;
  const cats = p.categories.filter((c) => c.kind === p.kind);
  const summary = [
    style?.title,
    state.aspect ?? style?.aspect,
    state.duration !== null ? `${state.duration} s` : null,
    state.count > 1 ? `${state.count}×` : null,
  ].filter(Boolean).join(" · ");
  const step = (() => {
    let n = 0;
    return () => ++n;
  })();

  return (
    <aside className="panel gp ma-builder" aria-label="Build a creative">
      <GpModes
        label="Medium"
        modes={[{ id: "image", label: "Image", icon: <GImage /> }, { id: "video", label: "Video", icon: <GVideo /> }]}
        value={p.kind}
        onChange={(k) => p.onKind(k)}
      />

      <button type="button" className="ma-callout" onClick={p.onAgent}>
        <GAgent />
        <span><strong>Plan campaign</strong><span>A brief in, up to four creatives with caption and price out.</span></span>
        <GArrow />
      </button>

      <GpStep n={step()} title="Style" meta={cats.find((c) => c.id === style?.category)?.label} done={Boolean(style)}>
        <div className="ma-cats-row" role="group" aria-label="Category">
          {cats.map((c) => (
            <button key={c.id} type="button" className={`ma-cat-chip${p.category === c.id ? " is-on" : ""}`} aria-pressed={p.category === c.id} onClick={() => p.onCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <button type="button" className="ma-style" onClick={p.onStyleDialog} aria-haspopup="dialog" aria-label={`Choose style: ${style?.title ?? "none"}`}>
          <span className="ma-style__cover"><Cover src={style?.cover ?? null} alt="" eager /></span>
          <span className="ma-style__text">
            <span className="ma-style__kicker">{style?.base ? `Template · ${p.base?.title ?? "Style"}` : "Style"}</span>
            <span className="ma-style__name">{style?.title ?? "Choose style"}</span>
            <span className="ma-style__tag">{style ? `${style.kind === "video" ? "Video" : "Image"}${style.credits !== null ? ` · from ${style.credits} Credits` : ""}` : "From 34 styles and 102 templates"}</span>
          </span>
          <span className="ma-style__switch">Change</span>
        </button>
      </GpStep>

      {style && (style.product !== "none" || style.avatar !== "none") && (
        <GpStep
          n={step()}
          title={style.avatar !== "none" ? "Product and avatar" : "Product"}
          meta={style.product === "required" ? "required" : "optional"}
          done={Boolean(p.productImage) && (style.avatar !== "required" || Boolean(state.avatar))}
        >
          <div className="ma-slots">
            {style.product !== "none" && (
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
            {style.avatar !== "none" && (
              <AvatarSlot url={state.avatar} onUrl={(u) => p.onState({ avatar: u, consent: false })} onError={p.onError} required={style.avatar === "required"} />
            )}
          </div>
          {p.product?.description && <p className="ma-hint">{p.product.description.slice(0, 140)}</p>}
        </GpStep>
      )}

      {style && (
        <GpStep n={step()} title={textTitle} meta={needsWish ? "required" : "optional"} done={Boolean(state.wish.trim())}>
          <GpPrompt value={state.wish} onChange={(v) => p.onState({ wish: v })} placeholder={field?.placeholder ?? ""} onSubmit={p.onGenerate} max={field?.max ?? 200} rows={3} />
        </GpStep>
      )}

      {style?.adReference && (
        <GpStep n={step()} title="Ad reference" meta="optional" done={Boolean(state.adRef)}>
          <RefRow refs={p.refs} value={state.adRef} onChange={(u) => p.onState({ adRef: u })} onAdd={p.onAddRef} onError={p.onError} />
        </GpStep>
      )}

      {style && (style.aspects.length > 0 || style.duration || style.batch) && (
        <GpSettings summary={[state.aspect ?? style.aspect, state.duration !== null ? `${state.duration} s` : null, `${state.count}×`].filter(Boolean).join(" · ")}>
          <div className="ma-settings">
            {style.aspects.length > 0 && (
              <div className="ma-setting">
                <span className="ma-setting__label">Format</span>
                <div className="ma-aspects" role="radiogroup" aria-label="Format">
                  {style.aspects.map((a) => (
                    <button key={a} type="button" role="radio" aria-checked={state.aspect === a} className={`ma-aspect${state.aspect === a ? " is-on" : ""}`} onClick={() => p.onState({ aspect: a })}>
                      <AspectBox value={a} size={18} /><span>{a}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {style.duration && (
              <div className="ma-setting">
                <span className="ma-setting__label">Length</span>
                <div className="ma-aspects" role="radiogroup" aria-label="Length">
                  {(style.duration.steps ?? Array.from({ length: style.duration.max - style.duration.min + 1 }, (_, i) => style.duration!.min + i)).map((d) => (
                    <button key={d} type="button" role="radio" aria-checked={state.duration === d} className={`ma-aspect ma-aspect--num${state.duration === d ? " is-on" : ""}`} onClick={() => p.onState({ duration: d })}>
                      {d} s
                    </button>
                  ))}
                </div>
              </div>
            )}
            {style.batch && (
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
        </GpSettings>
      )}

      {style && style.avatar !== "none" && state.avatar && (
        <GpConsent checked={state.consent} onChange={(v) => p.onState({ consent: v })}>I am the person in the avatar photo or have their consent.</GpConsent>
      )}

      <GpFooter
        summary={summary || undefined}
        label={style?.chain ? "Start still + video" : "Generate"}
        busy={p.busy}
        missing={p.missing}
        price={p.priceState === "idle" ? total : null}
        priceHint={p.priceState === "loading" ? "…" : p.priceState === "error" ? "no price" : "–"}
        disabled={!p.canGo}
        onGo={p.onGenerate}
        title={p.missing ?? "Generate"}
        notice={p.error ? <p className="note note--error" role="alert">{p.error}</p> : p.tooExpensive ? <NotEnough need={total ?? 0} have={p.balance ?? 0} /> : style?.chain ? <p className="note">Two steps: a still, then it speaks. Keep the page open.</p> : null}
      />
    </aside>
  );
}

/** Saved ad references as a row: pick one, upload a new one (it is saved), or none. */
function RefRow({ refs, value, onChange, onAdd, onError }: { refs: AdRef[]; value: string | null; onChange: (u: string | null) => void; onAdd: (r: AdRef) => void; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const picker = useMediaPicker({
    kind: "image",
    onPick: ([url]) => {
      if (!url) return;
      if (!refs.some((r) => r.url === url)) onAdd({ id: crypto.randomUUID(), url, name: "Reference" });
      onChange(url);
    },
    onFiles: ([f]) => f && void pick(f),
  });
  async function pick(f: File) {
    setBusy(true);
    const res = await uploadImage(f);
    setBusy(false);
    if ("error" in res) return onError(res.error);
    onAdd({ id: crypto.randomUUID(), url: res.url, name: f.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Reference" });
    onChange(res.url);
  }
  // Seven fit in the row; a chosen one further back in the library comes first instead of being hidden.
  const chosen = value ? refs.find((r) => r.url === value) : undefined;
  const shown = chosen && !refs.slice(0, 7).includes(chosen) ? [chosen, ...refs.slice(0, 6)] : refs.slice(0, 7);
  return (
    <div className="ma-refs" role="radiogroup" aria-label="Ad reference">
      <button type="button" className="ma-ref ma-ref--add" onClick={(e) => picker.open(e.currentTarget)} aria-haspopup="dialog" aria-label="Add reference" title="An ad whose layout, colours and mood are taken over">
        {busy ? <span className="ring" aria-hidden="true" /> : <ImageUp />}
      </button>
      {value && !refs.some((r) => r.url === value) && (
        <button type="button" role="radio" aria-checked className="ma-ref is-on" onClick={() => onChange(null)} aria-label="Deselect reference">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" /><Check className="ma-ref__check" />
        </button>
      )}
      {shown.map((r) => (
        <button key={r.id} type="button" role="radio" aria-checked={value === r.url} className={`ma-ref${value === r.url ? " is-on" : ""}`} onClick={() => onChange(value === r.url ? null : r.url)} aria-label={`Reference ${r.name}`} title={r.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.url} alt="" />{value === r.url && <Check className="ma-ref__check" />}
        </button>
      ))}
      {value && <button type="button" className="ma-ref ma-ref--clear" onClick={() => onChange(null)} aria-label="No reference"><X /></button>}
      {picker.el}
    </div>
  );
}
