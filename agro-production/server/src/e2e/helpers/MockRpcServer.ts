/**
 * Minimal mock of the Soroban JSON-RPC 2.0 server used by the E2E harness.
 *
 * Handles exactly the methods that the server watcher and the client's
 * contractService call:
 *   - getLatestLedger
 *   - getEvents
 *   - getLedgerEntries  (used by rpc.Server.getAccount)
 *   - simulateTransaction
 *   - sendTransaction
 */
import http from "http";
import * as StellarSdk from "@stellar/stellar-sdk";
import { buildAccountLedgerEntry, buildSorobanTransactionData } from "./xdrBuilder.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MockRpcServer {
  private readonly server: http.Server;
  private currentLedger = 100;
  private readonly pendingEvents: object[] = [];
  private readonly contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        this.handleRequest(body, res);
      });
    });
  }

  /** Enqueue events to be served on the next getEvents call. */
  injectEvents(events: object[]): void {
    this.pendingEvents.push(...events);
  }

  /** Advance the mock chain tip ledger. */
  advanceLedger(by = 1): void {
    this.currentLedger += by;
  }

  start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve(port);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  get url(): string {
    const addr = this.server.address();
    if (typeof addr !== "object" || !addr) throw new Error("Server not started");
    return `http://127.0.0.1:${addr.port}`;
  }

  private handleRequest(body: string, res: http.ServerResponse): void {
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(body) as JsonRpcRequest;
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "bad json" }));
      return;
    }

    const result = this.dispatch(req);
    const response: JsonRpcResponse = { jsonrpc: "2.0", id: req.id, result };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  }

  private dispatch(req: JsonRpcRequest): unknown {
    switch (req.method) {
      case "getLatestLedger":
        return this.getLatestLedger();
      case "getEvents":
        return this.getEvents(req.params as { startLedger?: number } | undefined);
      case "getLedgerEntries":
        return this.getLedgerEntries(req.params as { keys?: string[] } | undefined);
      case "simulateTransaction":
        return this.simulateTransaction();
      case "sendTransaction":
        return this.sendTransaction();
      default:
        return null;
    }
  }

  private getLatestLedger() {
    return {
      id: "mockhash",
      protocolVersion: "21",
      sequence: this.currentLedger,
    };
  }

  private getEvents(params?: { startLedger?: number }) {
    // Drain the pending queue and return whatever events are present.
    // The watcher filters by contractId; we pre-fill events with the right id.
    const events = this.pendingEvents.splice(0);
    const latestLedger = this.currentLedger;
    return { events, latestLedger, cursor: `${latestLedger}-0` };
  }

  private getLedgerEntries(params?: { keys?: string[] }) {
    // Decode the requested key to find which public key is being looked up.
    // Return a minimal valid AccountEntry so the SDK can build a transaction.
    const keys = params?.keys ?? [];
    const entries = keys.map((keyBase64) => {
      try {
        const ledgerKey = StellarSdk.xdr.LedgerKey.fromXDR(keyBase64, "base64");
        if (ledgerKey.switch().value !== StellarSdk.xdr.LedgerEntryType.account().value) {
          return null;
        }
        const accountId = ledgerKey.account().accountId();
        const publicKey = StellarSdk.StrKey.encodeEd25519PublicKey(
          accountId.ed25519(),
        );
        const { keyBase64: k, entryBase64 } = buildAccountLedgerEntry(publicKey, 100);
        return { key: k, xdr: entryBase64, lastModifiedLedgerSeq: this.currentLedger };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return { entries, ledger: this.currentLedger };
  }

  private simulateTransaction() {
    let transactionData: string;
    try {
      transactionData = buildSorobanTransactionData();
    } catch {
      // Fallback: return enough for the SDK to not crash
      transactionData = "";
    }

    const returnVal = StellarSdk.xdr.ScVal.scvVoid().toXDR("base64");

    return {
      results: [{ auth: [], xdr: returnVal }],
      transactionData,
      minResourceFee: "1000",
      latestLedger: this.currentLedger,
      cost: { cpuInsns: "1000", memBytes: "1000" },
      stateChanges: [],
      id: "mock-sim",
      events: [],
    };
  }

  private sendTransaction() {
    const hash = "c".repeat(64);
    return {
      hash,
      status: "PENDING",
      latestLedger: this.currentLedger,
      latestLedgerCloseTime: Math.floor(Date.now() / 1000).toString(),
    };
  }
}
