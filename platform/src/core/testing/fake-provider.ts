import type { Provider, ProviderRequest, ProviderResult } from "../provider";

/** Scriptable provider for tests: queue the results that submit and poll return, in order. */
export function createFakeProvider() {
  const script: ProviderResult[] = [];
  const requests: ProviderRequest[] = [];
  let failures = 0;
  const unreachable = () => {
    if (failures > 0) {
      failures--;
      throw new Error("fake provider unreachable");
    }
  };
  const provider: Provider & {
    next(r: ProviderResult): void;
    failNextCalls(n: number): void;
    requests: ProviderRequest[];
  } = {
    requests,
    next(r) {
      script.push(r);
    },
    failNextCalls(n) {
      failures = n;
    },
    async submit(req) {
      unreachable();
      requests.push(req);
      return script.shift() ?? { state: "pending", handle: `fake_${requests.length}` };
    },
    async poll() {
      unreachable();
      return script.shift() ?? { state: "pending", handle: "fake" };
    },
  };
  return provider;
}
