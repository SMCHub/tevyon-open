"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageUp, Images, Link2, Package, Plus, UserRound, X } from "lucide-react";
import { uploadImage } from "@/components/studio/upload";
import { useMediaPicker } from "@/components/studio/media-picker";
import { LinkImport } from "./library";
import type { Product } from "./data";

function usePick(onUrl: (u: string) => void, onError: (e: string) => void) {
  const [busy, setBusy] = useState(false);
  async function pick(f: File) {
    setBusy(true);
    const res = await uploadImage(f);
    setBusy(false);
    if ("error" in res) return onError(res.error);
    onUrl(res.url);
  }
  return { busy, pick };
}

/** Clicks outside close a menu. */
function useOutside(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return root;
}

export function AvatarSlot({ url, onUrl, onError, required }: { url: string | null; onUrl: (u: string | null) => void; onError: (e: string) => void; required: boolean }) {
  const { busy, pick } = usePick(onUrl, onError);
  const picker = useMediaPicker({ kind: "image", onPick: ([u]) => u && onUrl(u), onFiles: ([f]) => f && void pick(f) });
  return (
    <div className={`ms-slot${url ? " has-image" : ""}`}>
      <button type="button" className="ms-slot__hit" onClick={(e) => picker.open(e.currentTarget)} aria-haspopup="dialog" aria-label={url ? "Replace avatar" : "Add avatar"} title={required ? "Photo of the person who speaks" : "Optional: without a photo the style picks a model"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt="" />}
        <span className="ms-slot__plus">{busy ? <span className="ring" aria-hidden="true" /> : url ? <UserRound /> : <Plus />}</span>
        <span className="ms-slot__label">Avatar{!required && !url && <em>optional</em>}</span>
      </button>
      {url && <button type="button" className="ms-slot__clear" onClick={() => onUrl(null)} aria-label="Remove avatar"><X /></button>}
      {picker.el}
    </div>
  );
}

/** One of the account's finished images, offered as a product photo. */
export type ResultPick = { id: string; url: string; label: string };

export function ProductSlot({ products, product, image, onChoose, onUpload, onImport, onClear, onManage, results = [], onResult }: {
  products: Product[]; product: Product | null; image: string | null; onChoose: (id: string) => void;
  onUpload: (f: File | string) => Promise<void>; onImport: (p: Omit<Product, "id" | "pick">) => Product; onClear: () => void; onManage: () => void;
  /** Own finished images to pick from; `onResult` copies one into the uploads and returns an error text or null. */
  results?: ResultPick[]; onResult?: (jobId: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [page, setPage] = useState<"main" | "link" | "results">("main");
  const [note, setNote] = useState<string | null>(null);
  const root = useOutside(menu, () => { setMenu(false); setPage("main"); setNote(null); });
  async function upload(f: File | string) {
    setBusy(true);
    setMenu(false);
    await onUpload(f);
    setBusy(false);
  }
  // “Upload photo” opens earlier uploads and results beside the slot; a new file is uploaded (and scanned).
  const picker = useMediaPicker({ kind: "image", onPick: ([u]) => u && void upload(u), onFiles: ([f]) => f && void upload(f) });
  async function result(id: string) {
    if (!onResult) return;
    setBusy(true);
    setNote(null);
    const err = await onResult(id);
    setBusy(false);
    if (err) return setNote(err);
    setMenu(false);
    setPage("main");
  }
  return (
    <div className={`ms-slot${image ? " has-image" : ""}`} ref={root}>
      <button type="button" className="ms-slot__hit" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label={product ? `Product: ${product.name}` : "Choose product"} title={product?.name ?? "Choose product"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt="" />}
        <span className="ms-slot__plus">{busy ? <span className="ring" aria-hidden="true" /> : image ? <Package /> : <Plus />}</span>
        <span className="ms-slot__label">{product ? product.name.slice(0, 14) || "Product" : "Product"}{!image && <em>Photo, shop link or saved</em>}</span>
      </button>
      {image && <button type="button" className="ms-slot__clear" onClick={onClear} aria-label="Deselect product"><X /></button>}
      {menu && (
        <div className="ms-menu" role="menu">
          {page === "link" ? (
            <LinkImport compact onDone={(p) => { onImport(p); setMenu(false); setPage("main"); }} />
          ) : page === "results" ? (
            <>
              <button type="button" className="ms-menu__item ms-menu__back" role="menuitem" onClick={() => { setPage("main"); setNote(null); }}><ChevronLeft /> From my results</button>
              <div className="ms-menu__results">
                {results.map((r) => (
                  <button key={r.id} type="button" className="ms-menu__result" role="menuitem" onClick={() => void result(r.id)} disabled={busy} title={r.label} aria-label={`Use result: ${r.label}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
              {note && <p className="note note--error" role="alert">{note}</p>}
            </>
          ) : (
            <>
              <button type="button" className="ms-menu__item" role="menuitem" onClick={() => { setMenu(false); picker.open(root.current); }}><ImageUp /> Upload photo</button>
              <button type="button" className="ms-menu__item" role="menuitem" onClick={() => setPage("link")}><Link2 /> From a product link</button>
              {onResult && results.length > 0 && (
                <button type="button" className="ms-menu__item" role="menuitem" onClick={() => setPage("results")}><Images /> From my results <span className="ms-menu__count">{results.length}</span></button>
              )}
              {products.length > 0 && <span className="ms-menu__head">Your products</span>}
              {products.slice(0, 6).map((p) => (
                <button key={p.id} type="button" className="ms-menu__item ms-menu__product" role="menuitem" onClick={() => { onChoose(p.id); setMenu(false); }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.images[p.pick] ?? p.images[0]} alt="" /><span>{p.name || "Product"}</span>
                </button>
              ))}
              <button type="button" className="ms-menu__item ms-menu__more" role="menuitem" onClick={() => { setMenu(false); onManage(); }}>Manage products <ChevronRight /></button>
            </>
          )}
        </div>
      )}
      {picker.el}
    </div>
  );
}
