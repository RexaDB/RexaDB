const CONNECT_ERROR_TARGET = /connect\s+E[A-Z]+\s+([^\s]+):\d+/;

// Unique-local (fc00::/7) and link-local (fe80::/10). The first group must be
// fully written out: `fd::1` is 00fd::1, which is outside both ranges.
const PRIVATE_IPV6 = /^(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i;

function isPrivateHost(target: string): boolean {
  const host = target.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (/\.local$/i.test(host)) return true;
  if (host.includes(":")) return PRIVATE_IPV6.test(host);
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * True when a socket connect error names a host on the local network. The
 * sidecar's Bun runtime reports most connect failures as ECONNREFUSED, including
 * ones macOS raises for a missing Local Network permission, so the error code
 * alone can't tell a refused connection from a blocked one.
 */
export function isLocalNetworkConnectError(error: string): boolean {
  const host = CONNECT_ERROR_TARGET.exec(error)?.[1];
  return host ? isPrivateHost(host) : false;
}
