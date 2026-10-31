import { describe, expect, test } from "bun:test";
import { setUniqueMachoUuid } from "../../scripts/set-macho-uuid.mjs";

const STOCK_UUID = "4c4c445655553144a175b24f7cbbd850";

function machO(payload: string, withUuid = true): Buffer {
  const binary = Buffer.alloc(32 + 16 + 24 + payload.length);
  binary.writeUInt32LE(0xfeedfacf, 0);
  binary.writeUInt32LE(withUuid ? 2 : 1, 16);
  binary.writeUInt32LE(0x19, 32);
  binary.writeUInt32LE(16, 36);
  if (withUuid) {
    binary.writeUInt32LE(0x1b, 48);
    binary.writeUInt32LE(24, 52);
    Buffer.from(STOCK_UUID, "hex").copy(binary, 56);
  }
  binary.write(payload, 72);
  return binary;
}

describe("setUniqueMachoUuid", () => {
  test("replaces the runtime's UUID with a valid version 4 style UUID", () => {
    const binary = machO("sidecar");
    const uuid = setUniqueMachoUuid(binary);
    expect(binary.subarray(56, 72).toString("hex")).toBe(uuid);
    expect(uuid).not.toBe(STOCK_UUID);
    expect(uuid[12]).toBe("4");
    expect("89ab").toContain(uuid[16]);
  });

  test("gives different builds different UUIDs and the same build the same one", () => {
    expect(setUniqueMachoUuid(machO("one"))).not.toBe(setUniqueMachoUuid(machO("two")));
    expect(setUniqueMachoUuid(machO("one"))).toBe(setUniqueMachoUuid(machO("one")));
  });

  test("leaves the rest of the file untouched", () => {
    const binary = machO("sidecar");
    const original = Buffer.from(binary);
    setUniqueMachoUuid(binary);
    expect(binary.subarray(0, 56).equals(original.subarray(0, 56))).toBe(true);
    expect(binary.subarray(72).equals(original.subarray(72))).toBe(true);
  });

  test("rejects files it can't patch", () => {
    expect(() => setUniqueMachoUuid(Buffer.alloc(64))).toThrow("not a thin 64-bit Mach-O");
    expect(() => setUniqueMachoUuid(machO("sidecar", false))).toThrow("no LC_UUID");
  });
});
