/** One stored file as a list shows it: its media URL, whether it is a picture or a clip, when it was stored (ms). */
export type ListedMedia = { url: string; kind: "image" | "video"; at: number };

/** Media store port. Provider outputs are copied here immediately; provider URLs expire. */
export interface MediaStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<string>;
}

export function createMemoryMediaStore(baseUrl: string) {
  const files = new Map<string, { data: Uint8Array; contentType: string }>();
  return {
    async put(key: string, data: Uint8Array, contentType: string) {
      const url = `${baseUrl}/${key}`;
      files.set(url, { data, contentType });
      return url;
    },
    read(url: string) {
      return files.get(url)?.data;
    },
  } satisfies MediaStore & { read(url: string): Uint8Array | undefined };
}
