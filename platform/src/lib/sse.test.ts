import { describe, expect, it } from "vitest";
import { readEvents } from "./sse";

function body(text: string, step: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += step) c.enqueue(bytes.slice(i, i + step));
      c.close();
    },
  });
}

describe("server-sent events in the browser", () => {
  it("reads every event whole, however the bytes are cut, umlauts included", async () => {
    const text = 'data: {"type":"text","delta":"Grüße aus Zürich"}\n\n: keepalive\n\ndata: {"type":"done","reply":"ß"}\n\n';
    for (const step of [1, 3, 7, 1000]) {
      const out: unknown[] = [];
      for await (const e of readEvents(body(text, step))) out.push(e);
      expect(out).toEqual([{ type: "text", delta: "Grüße aus Zürich" }, { type: "done", reply: "ß" }]);
    }
  });
});
