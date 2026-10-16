"use client";

import { useState } from "react";
import { Check, ImageUp, LayoutTemplate, Package, Plus, Trash2 } from "lucide-react";
import { uploadImage } from "@/components/studio/upload";
import { useMediaPicker } from "@/components/studio/media-picker";
import type { AdRef, Product } from "./data";

const MAX_IMAGES = 5;
const LINK_ERROR: Record<string, string> = {
  bad_url: "Please enter a full https address.",
  blocked_address: "This address is not publicly reachable.",
  no_product_found: "No product was found on this page.",
  timeout: "The page took too long.",
};

const host = (u?: string) => {
  try {
    return u ? new URL(u).hostname : "";
  } catch {
    return "";
  }
};

/** Product link: a shop page becomes a product with name, description and up to five images (own uploads). */
export function LinkImport({ onDone, compact = false }: { onDone: (p: Omit<Product, "id" | "pick">) => void; compact?: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/marketing/product-link", { method: "POST", body: JSON.stringify({ url: url.trim() }) }).catch(() => undefined);
    const res = (await r?.json().catch(() => undefined)) as { ok: boolean; error?: string; product?: { name: string; description: string; images: string[]; source: string } } | undefined;
    setBusy(false);
    if (!res?.ok || !res.product) return setError(LINK_ERROR[res?.error ?? ""] ?? "The page could not be read.");
    if (!res.product.images.length) return setError("No product image was found on the page. Upload a photo.");
    onDone({ name: res.product.name, description: res.product.description, images: res.product.images.slice(0, MAX_IMAGES), source: res.product.source });
    setUrl("");
  }
  return (
    <div className={`ms-linkimport${compact ? " ms-linkimport--compact" : ""}`}>
      <div className="ms-linkimport__row">
        <input className="wish" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.example/product" onKeyDown={(e) => e.key === "Enter" && run()} aria-label="Address of the product page" autoFocus={compact} />
        <button type="button" className="btn" onClick={run} disabled={busy || !url.trim()}>{busy ? <span className="ring" aria-hidden="true" /> : "Fetch"}</button>
      </div>
      <p className="note">Name, description and up to five images come from the page.</p>
      {error && <p className="note note--error" role="alert">{error}</p>}
    </div>
  );
}

export function ProductLibrary({ products, selected, onImport, onUse, onDelete, onUpdate, synced }: {
  products: Product[]; selected: string | null; synced: boolean; onImport: (p: Omit<Product, "id" | "pick">) => Product; onUse: (id: string) => void;
  onDelete: (id: string) => void; onUpdate: (p: Product) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useMediaPicker({
    kind: "image", multiple: true, max: Math.max(1, MAX_IMAGES - images.length),
    onPick: (urls) => setImages((list) => [...list, ...urls.filter((u) => !list.includes(u))].slice(0, MAX_IMAGES)),
    onFiles: (files) => void addFiles(files),
  });

  async function addFiles(files: File[]) {
    setError(null);
    setBusy(true);
    for (const f of files.slice(0, MAX_IMAGES - images.length)) {
      const res = await uploadImage(f);
      if ("error" in res) {
        setError(res.error);
        break;
      }
      setImages((list) => [...list, res.url].slice(0, MAX_IMAGES));
    }
    setBusy(false);
  }
  const reset = () => { setAdding(false); setImages([]); setName(""); setDescription(""); };

  return (
    <section className="ms-explore ms-lib" aria-label="Products">
      <div className="ms-explore__head">
        <h2 className="ms-explore__title">Products</h2>
        <p className="ms-fine">A product with name, description and up to five images, from your shop's link or by hand. The Marketing Agent plans with name and description. {synced ? "Saved in your account, on every device." : "Saved in this browser."}</p>
      </div>
      <div className="ms-lib__new">
        <LinkImport onDone={(p) => onUse(onImport(p).id)} />
        {adding ? (
          <div className="ms-lib__manual">
            <input className="wish" value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" maxLength={80} aria-label="Product name" />
            <textarea className="wish ms-lib__desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description (optional): what it is, what it does" maxLength={400} rows={2} aria-label="Description" />
            <div className="ms-thumbs">
              {images.map((src) => (
                <span key={src} className="ms-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" />
                </span>
              ))}
              {images.length < MAX_IMAGES && (
                <button type="button" className="ms-thumb ms-thumb--add" onClick={(e) => picker.open(e.currentTarget)} aria-haspopup="dialog" aria-label="Add image">{busy ? <span className="ring" aria-hidden="true" /> : <Plus />}</button>
              )}
            </div>
            {error && <p className="note note--error" role="alert">{error}</p>}
            <div className="ms-lib__manual-actions">
              <button type="button" className="btn" onClick={reset}>Cancel</button>
              <button type="button" className="btn glass" disabled={!images.length || busy} onClick={() => {
                onUse(onImport({ name: name.trim() || "Product", description: description.trim(), images }).id);
                reset();
              }}><Check aria-hidden="true" /> Save</button>
            </div>
            {picker.el}
          </div>
        ) : (
          <button type="button" className="ms-add" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> Add a product by hand</button>
        )}
      </div>
      {products.length ? (
        <div className="ms-lib__grid">
          {products.map((p) => (
            <article key={p.id} className={`ms-lib__item${p.id === selected ? " is-on" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="ms-lib__img" src={p.images[p.pick] ?? p.images[0]} alt="" />
              <div className="ms-lib__body">
                <input className="ms-lib__name" value={p.name} onChange={(e) => onUpdate({ ...p, name: e.target.value })} aria-label="Product name" />
                <span className="ms-lib__meta">{p.images.length} {p.images.length === 1 ? "image" : "images"}{host(p.source) ? ` · ${host(p.source)}` : ""}</span>
                {p.images.length > 1 && (
                  <div className="ms-thumbs">
                    {p.images.map((src, i) => (
                      <button key={src} type="button" className={`ms-thumb${i === p.pick ? " is-on" : ""}`} onClick={() => onUpdate({ ...p, pick: i })} aria-pressed={i === p.pick} aria-label={`Image ${i + 1} as main image`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <textarea className="ms-lib__desc ms-lib__desc--item" value={p.description} onChange={(e) => onUpdate({ ...p, description: e.target.value.slice(0, 400) })} placeholder="Description for the agent" rows={2} aria-label="Description" />
              <div className="ms-lib__actions">
                <button type="button" className="btn" onClick={() => onUse(p.id)}>{p.id === selected ? <><Check aria-hidden="true" /> Selected</> : "Use"}</button>
                <button type="button" className="icon-btn" aria-label={`Delete product ${p.name}`} onClick={() => onDelete(p.id)}><Trash2 /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty empty--compact"><Package aria-hidden="true" /><p>No products saved yet.</p></div>
      )}
    </section>
  );
}

/** Ad references: ads whose layout, palette and mood a run takes over (not their product, not their text). */
export function ReferenceLibrary({ refs, selected, styleTakesRef, onAdd, onUse, onDelete, onRename, synced }: {
  synced: boolean; refs: AdRef[]; selected: string | null; styleTakesRef: boolean; onAdd: (r: AdRef) => void; onUse: (url: string) => void; onDelete: (id: string) => void; onRename: (id: string, name: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useMediaPicker({
    kind: "image", multiple: true, max: 8,
    onPick: (urls) => urls.forEach((url) => onAdd({ id: crypto.randomUUID(), url, name: "Reference" })),
    onFiles: (files) => void add(files),
  });
  async function add(files: File[]) {
    setBusy(true);
    setError(null);
    for (const f of files.slice(0, 8)) {
      const res = await uploadImage(f);
      if ("error" in res) {
        setError(res.error);
        break;
      }
      onAdd({ id: crypto.randomUUID(), url: res.url, name: f.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Reference" });
    }
    setBusy(false);
  }
  return (
    <section className="ms-explore ms-lib" aria-label="Ad references">
      <div className="ms-explore__head">
        <h2 className="ms-explore__title">Ad references</h2>
        <p className="ms-fine">Ads you like. A run takes over their layout, colours and mood, never product or text. For product shots, ads and posters. {synced ? "Saved in your account, on every device." : "Saved in this browser."}</p>
      </div>
      <button type="button" className="ms-add" onClick={(e) => picker.open(e.currentTarget)} aria-haspopup="dialog" disabled={busy}>
        {busy ? <span className="ring" aria-hidden="true" /> : <ImageUp aria-hidden="true" />} Upload references
      </button>
      {picker.el}
      {error && <p className="note note--error" role="alert">{error}</p>}
      {!styleTakesRef && refs.length > 0 && <p className="note">The chosen style takes no reference. “Use” switches to an ad style that takes it.</p>}
      {refs.length ? (
        <div className="ms-refs">
          {refs.map((r) => (
            <article key={r.id} className={`ms-ref${r.url === selected ? " is-on" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.url} alt="" loading="lazy" />
              <div className="ms-ref__bar">
                <input className="ms-ref__name" value={r.name} onChange={(e) => onRename(r.id, e.target.value.slice(0, 40))} aria-label="Name of the reference" />
                <button type="button" className="btn" onClick={() => onUse(r.url)}>{r.url === selected ? <><Check aria-hidden="true" /> Active</> : "Use"}</button>
                <button type="button" className="icon-btn" onClick={() => onDelete(r.id)} aria-label={`Delete reference ${r.name}`}><Trash2 /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty empty--compact"><LayoutTemplate aria-hidden="true" /><p>No references yet. Upload ads whose look you want.</p></div>
      )}
    </section>
  );
}
