/** Reads server-sent events (`data: <json>` blocks, separated by a blank line) from a fetch body; comments are skipped. */
export async function* readEvents<T = unknown>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const data = buf.slice(0, cut).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        buf = buf.slice(cut + 2);
        if (!data) continue;
        try {
          yield JSON.parse(data) as T;
        } catch {
          // a broken event is skipped, the next one still counts
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
