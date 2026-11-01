import net from 'node:net';

/**
 * Addresses Chromium may never reach: this host, the Docker networks, the cloud metadata
 * service, and every other private, shared or reserved range (RFC 6890 and its updates).
 */
const BLOCKED = new net.BlockList();

const IPV4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/* NAT64, Teredo and 6to4 addresses can carry a private IPv4 address inside, so their whole
   ranges are refused rather than decoded. IPv4-mapped addresses (::ffff:a.b.c.d) cannot be
   listed here: BlockList matches every IPv4 address against such a rule. */
const IPV6 = [
  ['::', 127],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

for (const [address, prefix] of IPV4) {
  BLOCKED.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of IPV6) {
  BLOCKED.addSubnet(address, prefix, 'ipv6');
}

/** IPv4-mapped and IPv4-compatible IPv6 forms, in any spelling `net.isIP` accepts. */
const EMBEDDED_IPV4 =
  /^(?:0{0,4}:){0,5}(?:0{0,4}:|ffff:)(?:\d{1,3}\.){3}\d{1,3}$|^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i;

/** True only for a literal IPv4 or IPv6 address on the public internet. */
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 0) {
    return false;
  }
  if (family === 6 && EMBEDDED_IPV4.test(address)) {
    return false;
  }
  return !BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Ports pages may connect to: plain and secure web only. */
export const WEB_PORTS = Object.freeze([80, 443]);

/** The URL the session may open: http(s) only, with a host. Throws `invalid_url` otherwise. */
export function readWebUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw Object.assign(new Error('Not a URL'), { code: 'invalid_url' });
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
    throw Object.assign(new Error('Only http and https addresses open'), { code: 'invalid_url' });
  }
  return url;
}
