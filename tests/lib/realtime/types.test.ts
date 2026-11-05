import { describe, expect, test } from "bun:test";
import { realtimeProviderFor } from "@/lib/realtime/types";

describe("realtimeProviderFor", () => {
  test("detects management pointers", () => {
    expect(realtimeProviderFor("neon-cli://default/proj/br/neondb?role=owner")).toBe("neon");
    expect(realtimeProviderFor("supabase-mgmt://abcdefghijklmnopqrst?token=x")).toBe("supabase");
  });

  test("ignores direct connections, which hold no API credentials", () => {
    expect(realtimeProviderFor("postgres://u:p@ep-x.us-east-2.aws.neon.tech/neondb")).toBeNull();
    expect(realtimeProviderFor("postgres://u:p@db.abcdefghijklmnopqrst.supabase.co/postgres")).toBeNull();
    expect(realtimeProviderFor(undefined)).toBeNull();
  });
});
