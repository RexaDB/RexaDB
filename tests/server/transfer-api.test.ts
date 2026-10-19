import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TransferService } from "@/lib/transfer/transfer-service";
import type {
  ProviderAdapter,
  ProviderType,
  TransferOptions,
} from "@/lib/transfer/transfer-types";
import type { TransferApiRequest } from "@/lib/transfer/transfer-client";
import {
  getActiveTransferIdForDestination,
  handleTransferProgressEffect,
  handleTransferStartEffect,
  resetTransferJobsForTests,
  setTransferServiceFactoryForTests,
} from "../../server/transfer-api";

function stubAdapter(
  type: ProviderType,
  opts?: { validate?: boolean },
): ProviderAdapter {
  const validate = opts?.validate ?? true;
  return {
    type,
    validateConnection: async () => validate,
    exportDatabase: async () => ({
      schemaSql: "-- stub",
      tables: ["public.t"],
      rowCounts: { "public.t": 0 },
    }),
    importDatabase: async () => ({
      warnings: [],
      stats: { tablesTransferred: 1, rowsTransferred: 0 },
    }),
  };
}

function makeService(
  adapters: ProviderAdapter[],
): Effect.Effect<TransferService, never> {
  return Effect.sync(() => {
    const service = new TransferService();
    for (const adapter of adapters) service.registerAdapter(adapter);
    return service;
  });
}

const baseOptions: TransferOptions = {
  includeDatabase: true,
  includeStorage: false,
  includeAuth: false,
  includeSettings: false,
};

function requestFor(dest: string): TransferApiRequest {
  return {
    sourceProvider: "postgres",
    destinationProvider: "postgres",
    sourceConnectionString: "postgres://source",
    destinationConnectionString: dest,
    options: baseOptions,
  };
}

async function waitForDone(
  transferId: string,
  timeoutMs = 3000,
): Promise<Awaited<ReturnType<typeof pollOnce>>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await pollOnce(transferId);
    if (status.done) return status;
    await Bun.sleep(10);
  }
  throw new Error(`Transfer ${transferId} did not finish within ${timeoutMs}ms`);
}

async function pollOnce(transferId: string) {
  return Effect.runPromise(handleTransferProgressEffect(transferId));
}

describe("transfer-api job lifecycle (Effect.runFork)", () => {
  beforeEach(() => {
    resetTransferJobsForTests();
    setTransferServiceFactoryForTests(null);
  });

  afterEach(() => {
    resetTransferJobsForTests();
    setTransferServiceFactoryForTests(null);
  });

  test("success: fork completes, poll exposes result, destination lock released", async () => {
    const dest = `postgres://dest-success-${Date.now()}`;
    setTransferServiceFactoryForTests(() =>
      makeService([stubAdapter("postgres")]),
    );

    const start = await Effect.runPromise(
      handleTransferStartEffect(requestFor(dest)),
    );
    expect(start.success).toBe(true);
    expect(start.transferId).toBeTruthy();

    // Lock held while the background fiber runs (or already finished).
    const transferId = start.transferId!;

    const status = await waitForDone(transferId);
    expect(status.done).toBe(true);
    expect(status.result?.success).toBe(true);
    expect(status.error).toBeUndefined();
    expect(getActiveTransferIdForDestination(dest)).toBeUndefined();

    // A new transfer to the same destination can start after unlock.
    const again = await Effect.runPromise(
      handleTransferStartEffect(requestFor(dest)),
    );
    expect(again.success).toBe(true);
    expect(again.transferId).toBeTruthy();
    await waitForDone(again.transferId!);
    expect(getActiveTransferIdForDestination(dest)).toBeUndefined();
  });

  test("validation failure: poll exposes error and destination lock is released", async () => {
    const dest = `postgres://dest-fail-${Date.now()}`;
    setTransferServiceFactoryForTests(() =>
      makeService([stubAdapter("postgres", { validate: false })]),
    );

    const start = await Effect.runPromise(
      handleTransferStartEffect(requestFor(dest)),
    );
    expect(start.success).toBe(true);
    const transferId = start.transferId!;

    const status = await waitForDone(transferId);
    expect(status.done).toBe(true);
    expect(status.result?.success).toBe(false);
    expect(status.result?.error ?? status.error).toContain(
      "Source connection validation failed",
    );
    expect(getActiveTransferIdForDestination(dest)).toBeUndefined();
  });

  test("rejects a second start while the destination lock is held", async () => {
    const dest = `postgres://dest-lock-${Date.now()}`;
    let releaseValidate!: () => void;
    const validateGate = new Promise<void>((resolve) => {
      releaseValidate = resolve;
    });

    setTransferServiceFactoryForTests(() =>
      makeService([
        {
          ...stubAdapter("postgres"),
          validateConnection: async () => {
            await validateGate;
            return true;
          },
        },
      ]),
    );

    const first = await Effect.runPromise(
      handleTransferStartEffect(requestFor(dest)),
    );
    expect(first.success).toBe(true);

    const clash = await Effect.runPromise(
      handleTransferStartEffect(requestFor(dest)),
    );
    expect(clash.success).toBe(false);
    expect(clash.error).toContain("already running");
    expect(getActiveTransferIdForDestination(dest)).toBe(first.transferId);

    releaseValidate();
    await waitForDone(first.transferId!);
    expect(getActiveTransferIdForDestination(dest)).toBeUndefined();
  });
});
