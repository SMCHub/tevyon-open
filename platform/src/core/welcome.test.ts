import { describe, expect, it } from "vitest";
import { repositories } from "./testing/repositories";
import { isDisposable, isMassMailProvider, mailbox, welcome } from "./welcome";

const A = "00000000-0000-4000-8000-0000000000f1";
const B = "00000000-0000-4000-8000-0000000000f2";

describe("mailbox behind an e-mail address", () => {
  it("drops case and +tags, and the dots Gmail ignores", () => {
    expect(mailbox("Robin+Tevyon@Example.CH")).toBe("robin@example.ch");
    expect(mailbox("r.o.b.i.n+x@googlemail.com")).toBe("robin@gmail.com");
    expect(mailbox("r.obin@gmx.ch")).toBe("r.obin@gmx.ch");
    expect(mailbox("no-at-sign")).toBeUndefined();
    expect(mailbox("+only@example.ch")).toBeUndefined();
  });

  it("knows the large mail providers, where every address is its own account, from domains anyone can point anywhere", () => {
    for (const big of ["x@gmail.com", "x@googlemail.com", "x@outlook.com", "x@hotmail.ch", "x@icloud.com", "x@gmx.ch", "x@bluewin.ch", "x@proton.me", "x@yahoo.de"]) {
      expect(isMassMailProvider(big), big).toBe(true);
    }
    // An own domain can catch every address at it: many mailboxes for the price of one.
    for (const own of ["x@my-shop.ch", "x@studio-lena.de", "x@mail.gmx.ch.example.com", "no-at-sign"]) expect(isMassMailProvider(own), own).toBe(false);
  });

  it("knows throwaway domains, subdomains included, and leaves real providers alone", () => {
    expect(isDisposable("x@mailinator.com")).toBe(true);
    expect(isDisposable("x@inbox.mailinator.com")).toBe(true);
    expect(isDisposable("x@yopmail.com")).toBe(true);
    for (const real of ["x@gmail.com", "x@bluewin.ch", "x@gmx.ch", "x@outlook.com", "x@proton.me", "x@icloud.com"]) expect(isDisposable(real)).toBe(false);
  });
});

describe.each(repositories)("%s repository: welcome credits", (_name, makeRepo) => {
  it("gives the welcome credits once per mailbox, however the address is written", async () => {
    const repo = await makeRepo();

    expect(await welcome(repo, { id: A, email: "robin+one@gmail.com" }, 100)).toBe("granted");
    expect(await welcome(repo, { id: A, email: "robin+one@gmail.com" }, 100)).toBe("already");
    expect(await welcome(repo, { id: B, email: "R.O.B.I.N@googlemail.com" }, 100)).toBe("mailbox_used");

    expect([await repo.balance(A), await repo.balance(B)]).toEqual([100, 0]);
    expect(JSON.stringify(await repo.grants(A))).not.toContain("robin");
  });

  it("gives nothing to throwaway addresses, anonymous sessions or sessions without an address", async () => {
    const repo = await makeRepo();

    expect(await welcome(repo, { id: A, email: "test@mailinator.com" }, 100)).toBe("disposable");
    expect(await welcome(repo, { id: A, email: "real@example.ch", anonymous: true }, 100)).toBe("anonymous");
    expect(await welcome(repo, { id: A }, 100)).toBe("no_email");
    expect(await repo.balance(A)).toBe(0);
  });

  it("holds the credits back while the network's share for the day is used up, and gives them on a later visit", async () => {
    const repo = await makeRepo();
    let open = false;
    let asked = 0;
    const gate = async () => (asked++, open);

    expect(await welcome(repo, { id: A, email: "late@example.ch" }, 100, gate)).toBe("network_limit");
    expect(await repo.balance(A)).toBe(0);
    open = true;
    expect(await welcome(repo, { id: A, email: "late@example.ch" }, 100, gate)).toBe("granted");
    expect(await repo.balance(A)).toBe(100);

    // Only a grant about to happen counts against the network: never a welcomed account, a throwaway or an anonymous one.
    open = false;
    expect(await welcome(repo, { id: A, email: "late@example.ch" }, 100, gate)).toBe("already");
    expect(await welcome(repo, { id: B, email: "x@mailinator.com" }, 100, gate)).toBe("disposable");
    expect(await welcome(repo, { id: B, email: "y@example.ch", anonymous: true }, 100, gate)).toBe("anonymous");
    expect(asked).toBe(2);
  });

  it("does not welcome an account a second time that got its credits under the old rule", async () => {
    const repo = await makeRepo();
    await repo.grant(A, 100, `welcome:${A}`);

    expect(await welcome(repo, { id: A, email: "old@example.ch" }, 100)).toBe("already");
    expect(await repo.balance(A)).toBe(100);
  });
});
