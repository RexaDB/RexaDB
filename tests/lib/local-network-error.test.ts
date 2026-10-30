import { describe, expect, test } from "bun:test";
import { isLocalNetworkConnectError } from "@/lib/connections/local-network-error";

describe("isLocalNetworkConnectError", () => {
  test.each([
    "connect ECONNREFUSED 192.168.1.4:5432",
    "connect EHOSTUNREACH 10.0.0.2:3306",
    "connect ETIMEDOUT 172.16.0.9:5432",
    "connect ECONNREFUSED 169.254.10.1:5432",
    "connect ECONNREFUSED raspberrypi.local:5432",
    "connect ECONNREFUSED fd00::4:5432",
    "connect ECONNREFUSED [fd00::4]:5432",
    "connect ECONNREFUSED fc00::1:5432",
    "connect ECONNREFUSED fe80::1:5432",
    "connect ECONNREFUSED [FEBF::1]:5432",
    "connect ECONNREFUSED [fe80::1%en0]:5432",
    "connect ECONNREFUSED fe80::1%en0:5432",
  ])("matches %s", (error) => {
    expect(isLocalNetworkConnectError(error)).toBe(true);
  });

  test.each([
    "connect ECONNREFUSED 127.0.0.1:5432",
    "connect ECONNREFUSED 8.8.8.8:5432",
    "connect ECONNREFUSED 172.32.0.1:5432",
    "connect ECONNREFUSED db.example.com:5432",
    "connect ECONNREFUSED ::1:5432",
    "connect ECONNREFUSED [::1]:5432",
    "connect ECONNREFUSED 2001:db8::1:5432",
    "connect ECONNREFUSED [fec0::1]:5432",
    "connect ECONNREFUSED fd::1:5432",
    'password authentication failed for user "192.168.1.4"',
  ])("ignores %s", (error) => {
    expect(isLocalNetworkConnectError(error)).toBe(false);
  });
});
