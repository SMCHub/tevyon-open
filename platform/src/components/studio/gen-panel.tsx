"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { TokenGlyph } from "./tachyon-token";
import "./gen-panel.css";

/**
 * Building blocks of every generation sidebar (video studio, presets): mode switch, compact model row, numbered
 * steps, collapsible settings and a sticky footer with summary and price. Monochrome, glass for what is on.
 * `.gp--compact` on the panel (video studio, 15.10.2026) flattens the steps into sections and shows the settings as
 * a row of pills (GpOptions) instead of the folded block.
 */

export function GpModes<T extends string>({ modes, value, onChange, label }: {
  modes: { id: T; label: string; icon: React.ReactNode }[]; value: T; onChange: (id: T) => void; label: string;
}) {
  return (
    <div className="gp-modes" role="tablist" aria-label={label} style={{ "--n": modes.length } as React.CSSProperties}>
      {modes.map((m) => (
        <button key={m.id} type="button" role="tab" aria-selected={value === m.id} className="gp-modes__btn" onClick={() => onChange(m.id)}>
          {m.icon}
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The chosen model in one row: cover, name, tagline and the switch (a picker) on the right. */
export function GpModel({ cover, name, tagline, kicker = "Modell", children }: { cover: string | null; name: string; tagline?: string; kicker?: string; children?: React.ReactNode }) {
  return (
    <div className="gp-model">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {cover ? <img className="gp-model__cover" src={cover} alt="" /> : <span className="gp-model__cover" />}
      <span className="gp-model__text">
        <span className="gp-model__kicker">{kicker}</span>
        <span className="gp-model__name">{name}</span>
        {tagline && <span className="gp-model__tag">{tagline}</span>}
      </span>
      {children && <span className="gp-model__switch">{children}</span>}
    </div>
  );
}

/** One step: number, title, what it needs on the right (e.g. «4–30 s», «optional», «2/9»), then its content. */
export function GpStep({ n, title, meta, done = false, children }: { n?: number; title: string; meta?: React.ReactNode; done?: boolean; children: React.ReactNode }) {
  return (
    <section className={`gp-step${done ? " is-done" : ""}`}>
      <header className="gp-step__head">
        {n !== undefined && <span className="gp-step__n" aria-hidden="true">{n}</span>}
        <span className="gp-step__title">{title}</span>
        {meta !== undefined && <span className="gp-step__meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

/** A prompt box with a counter and the shortcut hint inside. */
export function GpPrompt({ value, onChange, placeholder, onSubmit, max = 4000, rows = 4 }: {
  value: string; onChange: (v: string) => void; placeholder: string; onSubmit?: () => void; max?: number; rows?: number;
}) {
  return (
    <div className="gp-prompt">
      <textarea
        className="gp-prompt__input"
        rows={rows}
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
        }}
      />
      <span className="gp-prompt__foot">
        <span>{onSubmit ? "⌘↵ startet" : ""}</span>
        <span>{value.length}/{max}</span>
      </span>
    </div>
  );
}

/** Settings folded to one line («8 s · 720p · 16:9 · Ton») until opened. */
export function GpSettings({ summary, children, defaultOpen = false }: { summary: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`gp-settings${open ? " is-open" : ""}`}>
      <button type="button" className="gp-settings__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="gp-step__title">Einstellungen</span>
        <span className="gp-settings__sum">{summary}</span>
        <ChevronDown className="gp-settings__chev" aria-hidden="true" />
      </button>
      {open && <div className="gp-settings__body">{children}</div>}
    </section>
  );
}

/** The model's settings as a row of pills (format, resolution, length, sound), each opening its own choice. */
export function GpOptions({ children }: { children: React.ReactNode }) {
  return <div className="gp-opts" role="group" aria-label="Einstellungen">{children}</div>;
}

/** The consent line, compact. */
export function GpConsent({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="gp-consent">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/**
 * Sticky footer: what will be made (summary) and the button with the price. The balance lives in the account menu only
 *.
 * `missing` replaces the label while something is still needed («Video fehlt»), so the button says why it waits.
 */
export function GpFooter({ summary, label, busy, missing, price, priceHint, disabled, onGo, title, notice }: {
  summary?: string; label: string; busy: boolean; missing?: string | null; price: number | null; priceHint?: string;
  disabled: boolean; onGo: () => void; title?: string; notice?: React.ReactNode;
}) {
  return (
    <footer className="gp-foot">
      {notice}
      {summary && <p className="gp-foot__sum">{summary}</p>}
      <button type="button" className="gp-go" onClick={onGo} disabled={disabled} title={title}>
        <span className="gp-go__label">{busy ? "Startet …" : missing ?? label}</span>
        <span className="gp-go__price">{price !== null ? <><TokenGlyph />{price}</> : <span className="gp-go__hint">{priceHint ?? "…"}</span>}</span>
      </button>
    </footer>
  );
}

/** «8 s · 720p · 16:9 · Ton» from a job's options (only what is set). */
export function gpSummary(opts: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof opts.duration === "number") parts.push(`${opts.duration} s`);
  if (typeof opts.resolution === "string") parts.push(opts.resolution);
  if (typeof opts.aspect_ratio === "string") parts.push(opts.aspect_ratio);
  if (opts.generate_audio === true) parts.push("Ton");
  if (opts.generate_audio === false) parts.push("ohne Ton");
  return parts.join(" · ");
}
