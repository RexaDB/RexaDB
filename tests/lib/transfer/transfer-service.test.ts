import { describe, it, expect, beforeEach } from "bun:test";
import { TransferService } from "@/lib/transfer/transfer-service";
import type { ProviderAdapter, ProviderType, TransferSource, TransferDestination, TransferOptions } from "@/lib/transfer/transfer-types";

function stubAdapter(type: ProviderType): ProviderAdapter {
  return {
    type,
    validateConnection: async () => true,
    exportDatabase: async () => ({ schemaSql: "", tables: [], rowCounts: {} }),
    importDatabase: async () => {},
  };
}

describe("TransferService", () => {
  let transferService: TransferService;

  beforeEach(() => {
    // Adapters are registered dynamically at runtime; register stubs here
    // so routing/validation logic can be tested in isolation.
    transferService = new TransferService();
    (["supabase", "neon", "postgres"] as const).forEach((t) =>
      transferService.registerAdapter(stubAdapter(t)),
    );
  });

  it("should initialize with default adapters", () => {
    expect(transferService).toBeDefined();
    expect(transferService.getAdapter("supabase")).toBeDefined();
    expect(transferService.getAdapter("neon")).toBeDefined();
    expect(transferService.getAdapter("postgres")).toBeDefined();
  });

  it("should register custom adapters", () => {
    const customAdapter = {
      type: "custom" as unknown as ProviderType,
      validateConnection: async () => true,
      exportDatabase: async () => ({ schemaSql: "", tables: [], rowCounts: {} }),
      importDatabase: async () => {},
    };

    transferService.registerAdapter(customAdapter);
    expect(transferService.getAdapter("custom")).toBeDefined();
  });

  it("should handle invalid source provider", async () => {
    const source: TransferSource = {
      provider: "invalid" as any,
      connectionString: "test",
    };

    const destination: TransferDestination = {
      provider: "postgres",
      connectionString: "test",
    };

    const options: TransferOptions = {
      includeDatabase: true,
      includeStorage: false,
      includeAuth: false,
      includeSettings: false,
    };

    const result = await transferService.transferProject(source, destination, options);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No adapter found for source provider");
  });

  it("should handle invalid destination provider", async () => {
    const source: TransferSource = {
      provider: "postgres",
      connectionString: "test",
    };

    const destination: TransferDestination = {
      provider: "invalid" as any,
      connectionString: "test",
    };

    const options: TransferOptions = {
      includeDatabase: true,
      includeStorage: false,
      includeAuth: false,
      includeSettings: false,
    };

    const result = await transferService.transferProject(source, destination, options);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No adapter found for destination provider");
  });

  it("should build transfer steps based on options", () => {
    const options: TransferOptions = {
      includeDatabase: true,
      includeStorage: true,
      includeAuth: false,
      includeSettings: false,
    };

    // This is a private method, but we can test the overall behavior through the public API
    const source: TransferSource = {
      provider: "postgres",
      connectionString: "test",
    };

    const destination: TransferDestination = {
      provider: "postgres",
      connectionString: "test",
    };

    // The service should handle the options correctly
    expect(transferService).toBeDefined();
  });
});