"use client";

import { useRef, useState } from "react";
import { Film, ImageUp, X } from "lucide-react";
import { PreviewButton, usePreview } from "./media-preview";
import { useMediaPicker } from "./media-picker";

const UPLOAD_ERROR: Record<string, string> = {
  too_large: "Die Datei ist zu gross (Foto bis 10 MB, Video bis 50 MB).",
  not_an_image: "Bitte ein Foto als JPG, PNG oder WebP.",
  unreadable_video: "Die Länge des Videos lässt sich nicht lesen. Bitte als MP4 oder MOV exportieren.",
  scan_unavailable: "Die Prüfung des Uploads klappt gerade nicht. Bitte versuch es gleich nochmals.",
  upload_limit: "Für heute sind die Uploads aufgebraucht (200 pro Tag). Morgen geht es weiter.",
};

/** Why the scan refused a file (core/upload-scan.ts). Minors and «other» stay general on purpose. */
const BLOCKED: Record<string, string> = {
  nudity: "Nacktheit und sexuelle Inhalte sind auf Tevyon nicht erlaubt.",
  violence: "Drastische Gewalt ist auf Tevyon nicht erlaubt.",
  extremism: "Extremistische oder hasserfüllte Inhalte sind auf Tevyon nicht erlaubt.",
  documents: "Ausweise und amtliche Dokumente nehmen wir nicht an.",
};
const blockedText = (category?: string) => `Nicht hochgeladen: ${BLOCKED[category ?? ""] ?? "Die Datei verstösst gegen unsere Nutzungsrichtlinien."}`;
const VIDEO_ERROR: Record<string, string> = { ...UPLOAD_ERROR, not_an_image: "Bitte ein Video als MP4 oder MOV." };

/** Length in seconds of an uploaded reference video, from its media URL ("…_12s.mp4"), or null for any other file. */
export function videoSecondsOf(url: string): number | null {
  const m = /_(\d{1,3})s\.mp4$/.exec(url);
  return m ? Number(m[1]) : null;
}

/** Uploads one image (or a reference video) to /api/uploads: its own media URL, or the message to show. */
/** Hosting takes at most 4.5 MB per request; larger photos are scaled down in the browser first. */
const MAX_BODY = 4 * 1024 * 1024;
const MAX_SIDE = 2560;

/** A photo above the request limit as a JPEG of at most 2560 px on the long side (plenty for references and start frames). */
async function shrink(file: File): Promise<Blob> {
  if (file.size <= MAX_BODY || !/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BODY) return blob;
    }
  } catch {
    // Unreadable in the browser: send it as it is and let the server answer.
  }
  return file;
}

export async function uploadImage(file: File, kind: "image" | "video" = "image"): Promise<{ url: string } | { error: string }> {
  const body = kind === "image" ? await shrink(file) : file;
  const r = await fetch("/api/uploads", { method: "POST", body }).catch(() => undefined);
  const res = (await r?.json().catch(() => undefined) ?? { ok: false }) as { ok: boolean; url?: string; error?: string; category?: string };
  const texts = kind === "video" ? VIDEO_ERROR : UPLOAD_ERROR;
  if (res.error === "upload_blocked") return { error: blockedText(res.category) };
  if (!res.ok || !res.url) return { error: texts[res.error ?? ""] ?? "Upload hat nicht geklappt." };
  return { url: res.url };
}

/** Uploads one image (or with kind "video" one reference video) to /api/uploads and returns its own media URL. */
export function useUpload(kind: "image" | "video" = "image") {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(file: File) {
    setError(null);
    setBusy(true);
    const res = await uploadImage(file, kind);
    setBusy(false);
    if ("error" in res) return setError(res.error);
    setUrl(res.url);
  }
  return { url, setUrl, busy, error, upload, kind };
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Drop zone for one photo (or video): a click opens the media picker beside it (earlier uploads, own results, or a new
 * file), a dropped file uploads at once; preview with remove button. `icons` replace the default icon.
 */
export function DropZone({ up, title, hint, icons }: { up: ReturnType<typeof useUpload>; title: string; hint: string; icons?: React.ReactNode[] }) {
  const zone = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const preview = usePreview();
  const picker = useMediaPicker({ kind: up.kind, onPick: ([url]) => url && up.setUrl(url), onFiles: ([f]) => f && void up.upload(f) });
  return (
    <div
      ref={zone}
      className={`drop${drag ? " is-drag" : ""}${up.url ? " has-image" : ""}${picker.isOpen ? " is-open" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-haspopup="dialog"
      aria-expanded={picker.isOpen}
      onClick={() => picker.open(zone.current)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        picker.open(zone.current);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) up.upload(f);
      }}
    >
      {up.url ? (
        <>
          {up.kind === "video"
            ? <video src={up.url} muted loop autoPlay playsInline aria-label="Dein Video" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={up.url} alt="Dein Foto" />}
          <span className="drop__swap">Ersetzen</span>
          <PreviewButton
            className="pv-open--beside"
            onOpen={() => preview.openEntries([{ url: up.url!, kind: up.kind, chip: "Dein Upload", title: up.kind === "video" ? "Dein Video" : "Dein Foto" }])}
          />
          <button
            type="button"
            className="icon-btn drop__clear"
            aria-label={up.kind === "video" ? "Video entfernen" : "Foto entfernen"}
            onClick={(e) => {
              e.stopPropagation();
              up.setUrl(null);
            }}
          >
            <X />
          </button>
        </>
      ) : (
        <span className="drop__empty">
          <span className="drop__icons">
            {up.busy ? <span className="drop__icon"><span className="ring" aria-hidden="true" /></span>
              : (icons ?? [up.kind === "video" ? <Film key="f" aria-hidden="true" /> : <ImageUp key="i" aria-hidden="true" />]).map((icon, i) => <span key={i} className="drop__icon">{icon}</span>)}
          </span>
          <span className="drop__text">
            <span className="drop__title">{up.busy ? "Wird hochgeladen und geprüft …" : title}</span>
            <span className="drop__sub">{hint}</span>
          </span>
        </span>
      )}
      {/* The picker portals its card to the body, but React events still bubble here: keep them in the card. */}
      <span onClick={stop} onKeyDown={stop} onDragOver={stop} onDragLeave={stop} onDrop={stop}>{picker.el}</span>
    </div>
  );
}
