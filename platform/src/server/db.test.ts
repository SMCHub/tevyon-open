import { EventEmitter } from "node:events";
import net from "node:net";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createPgDb, dbOnPool } from "./db";

/** A pg client stand-in: the socket "dies" when a query contains BREAK, the way node-postgres reports it. */
class FakeClient extends EventEmitter {
  sql: string[] = [];
  released: (Error | undefined)[] = [];
  async query(sql: string) {
    this.sql.push(sql);
    if (sql.includes("BREAK")) {
      const err = new Error("Connection terminated unexpectedly");
      // pg emits the socket error from the socket's event handler, outside any promise chain.
      setImmediate(() => this.emit("error", err));
      await new Promise((r) => setTimeout(r, 5));
      throw err;
    }
    if (sql.includes("CONSTRAINT")) throw new pg.DatabaseError("duplicate key value", 0, "error");
    return { rows: [] };
  }
  release(err?: Error) {
    this.released.push(err);
  }
}

function fakePool(client: FakeClient) {
  return { query: async () => ({ rows: [] }), connect: async () => client };
}

const servers: net.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("database access", () => {
  it("keeps the process alive when an idle connection drops", () => {
    const db = createPgDb("postgres://u:p@127.0.0.1:1/idle-drop");
    expect(() => db.pool.emit("error", new Error("terminating connection due to administrator command"))).not.toThrow();
  });

  it("uses one pool per database for the whole process", () => {
    expect(createPgDb("postgres://u:p@127.0.0.1:1/shared").pool).toBe(createPgDb("postgres://u:p@127.0.0.1:1/shared").pool);
  });

  it("fails a query fast when the database accepts the connection but never answers", async () => {
    const server = net.createServer(() => {}); // accepts, then stays silent
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as net.AddressInfo;
    const db = createPgDb(`postgres://u:p@127.0.0.1:${port}/silent`, { connectTimeoutMs: 300 });

    const started = Date.now();
    await expect(db.query("select 1")).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
    await db.pool.end();
  });

  it("rejects a transaction whose connection dies, without crashing, and never reuses the dead connection", async () => {
    const client = new FakeClient();
    const db = dbOnPool(fakePool(client));

    await expect(db.tx(async (q) => q("update jobs set BREAK"))).rejects.toThrow("Connection terminated");
    await new Promise((r) => setTimeout(r, 20)); // let the emitted socket error land

    expect(client.released).toHaveLength(1);
    expect(client.released[0]).toBeInstanceOf(Error); // released with the error: pg-pool drops it
    expect(client.sql).not.toContain("rollback"); // a dead connection rolls back on the server by closing
    expect(client.listenerCount("error")).toBe(0);
  });

  it("rolls back a refused transaction and keeps the healthy connection", async () => {
    const client = new FakeClient();
    const db = dbOnPool(fakePool(client));

    await expect(db.tx(async (q) => q("insert CONSTRAINT"))).rejects.toThrow("duplicate key");

    expect(client.sql).toEqual(["begin", "insert CONSTRAINT", "rollback"]);
    expect(client.released).toEqual([undefined]);
  });
});
