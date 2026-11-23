/* Shared by deploy/browser and deploy/site-mcp, which build from their own directories, so each
   keeps a copy. The copies must stay byte-identical: `npm run verify:prod` fails when they differ. */
import net from 'node:net';

/**
 * Addresses a service may never reach: this host, the Docker networks, the cloud metadata
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
   ranges are refused rather than decoded. The three forms that embed an IPv4 address in the
   last 32 bits (mapped, translated, compatible) are refused by `embedsIpv4` instead: BlockList
   matches every IPv4 address against a ::ffff:0:0/96 rule. */
const IPV6 = [
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

/** The eight 16-bit groups of a valid IPv6 literal, a trailing dotted quad included. */
function hextets(address) {
  let text = address.toLowerCase();
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail == null ? [] : new Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((group) => Number.parseInt(group, 16));
}

/**
 * IPv4-mapped (::ffff:0:0/96), IPv4-translated (::ffff:0:0:0/96) and IPv4-compatible
 * (::/96, which also holds :: and ::1) addresses. All are refused, public or not, so no
 * spelling of an embedded IPv4 address can reach a private one.
 */
function embedsIpv4(address) {
  const groups = hextets(address);
  const zeros = (count) => groups.slice(0, count).every((group) => group === 0);
  return (
    zeros(6) ||
    (zeros(5) && groups[5] === 0xffff) ||
    (zeros(4) && groups[4] === 0xffff && groups[5] === 0)
  );
}

/** True only for a literal IPv4 or IPv6 address on the public internet. */
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 0) {
    return false;
  }
  if (family === 6 && embedsIpv4(address)) {
    return false;
  }
  return !BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
