import data from "@/core/data/motion-library.json";
import type { LibraryPreset } from "@/core/motion-library";

/** The motion library as the app shows it: our own recast templates (core/data/motion-library.json). */
export function motionLibrary(): LibraryPreset[] {
  return data.presets as LibraryPreset[];
}
