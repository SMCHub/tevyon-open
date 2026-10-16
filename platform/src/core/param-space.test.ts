import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { offeredOptions, paramSpace, SAMPLE_UPLOAD, standardParams } from "./param-space";

describe("param space", () => {
  it("lists the options a job type offers, from the same schema the studio renders", () => {
    expect(offeredOptions(catalog.get("veo_3_1_lite")!)).toEqual({
      image: [undefined, SAMPLE_UPLOAD],
      duration: [4, 6, 8],
      resolution: ["720p", "1080p"],
      aspect_ratio: ["16:9", "9:16"],
      generate_audio: [true, false],
    });
    expect(offeredOptions(catalog.get("kling_3_turbo")!).duration).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(offeredOptions(catalog.get("flux_3_image")!).references).toEqual([[], [SAMPLE_UPLOAD], Array(10).fill(SAMPLE_UPLOAD)]);
  });

  it("enumerates every valid parameter set", () => {
    // Start image or not × 3 lengths × 2 resolutions × 2 formats × sound on/off.
    expect(paramSpace(catalog.get("veo_3_1_lite")!)).toHaveLength(2 * 3 * 2 * 2 * 2);
    expect(paramSpace(catalog.get("kling_3_turbo")!)).toHaveLength(13 * 2 * 3);
    // 8 formats × 5 resolutions × none, one or ten references.
    expect(paramSpace(catalog.get("flux_3_image")!)).toHaveLength(8 * 5 * 3);
  });
});

describe("standard params", () => {
  it("are the defaults with a prompt", () => {
    expect(standardParams(catalog.get("veo_3_1_lite")!)).toEqual(catalog.get("veo_3_1_lite")!.params.parse({ prompt: "x" }));
    expect(standardParams(catalog.get("flux_3_image")!)).toEqual({ prompt: "x", aspect_ratio: "1:1", resolution: "1k", references: [] });
  });
});
