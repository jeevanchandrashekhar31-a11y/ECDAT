/**
 * ECDAT SSRF & Active Network Scanning Security Subsystem — Phase 8
 *
 * Implements comprehensive defense-in-depth Server-Side Request Forgery (SSRF)
 * protections and DNS rebinding (TOCTOU) defenses:
 *
 * 1. Complete IP Range Blocklist:
 *    - 127.0.0.0/8 (IPv4 Loopback)
 *    - 0.0.0.0/8 (Current network)
 *    - 10.0.0.0/8 (RFC 1918 Class A Private)
 *    - 172.16.0.0/12 (RFC 1918 Class B Private: 172.16.0.0 - 172.31.255.255)
 *    - 192.168.0.0/16 (RFC 1918 Class C Private)
 *    - 169.254.0.0/16 (RFC 3927 Link-Local & Cloud Metadata)
 *    - 100.64.0.0/10 (RFC 6598 Carrier-Grade NAT)
 *    - 192.0.0.0/24 (IETF Protocol Assignments)
 *    - 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (TEST-NET / Documentation)
 *    - 198.18.0.0/15 (Benchmarking)
 *    - 224.0.0.0/4 (Multicast)
 *    - 240.0.0.0/4 (Reserved / Future Use)
 *    - 255.255.255.255 (Broadcast)
 *    - IPv6 Loopback (::1, ::)
 *    - IPv6 Link-Local (fe80::/10)
 *    - IPv6 Unique Local Address (fc00::/7, including fd00::/8)
 *    - IPv6 Multicast (ff00::/8)
 *    - IPv4-Mapped IPv6 (::ffff:0:0/96 and ::ffff:0:0:0/96)
 *    - Cloud metadata endpoints (169.254.169.254, 169.254.169.253, 169.254.170.2, 100.100.100.200, fd00:ec2::254)
 *
 * 2. Hostname & Internal Target Blocklist:
 *    - localhost, *.localhost
 *    - cloud metadata hostnames (metadata.google.internal, instance-data, metadata.azure.com)
 *    - internal DNS suffixes (.local, .internal, .corp, .lan, .home, .home.arpa, .intranet, .priv, .private, .test, .invalid, .onion)
 *    - Unix socket and local file indicators
 *
 * 3. Asynchronous DNS Resolution & Anti-Rebinding (TOCTOU Defense):
 *    - Resolves all destination IP addresses before connection.
 *    - Verifies that every resolved address is safe and non-restricted.
 *    - Pins connection to validated IP address using custom lookup resolver.
 *    - Validates any HTTP 3xx redirect destinations before following.
 *
 * 4. Git URL Hardening:
 *    - Strict protocol allowlist (https, http, git@, ssh).
 *    - Complete rejection of file://, ext::, fd::, relative paths, null bytes, and shell characters.
 */

const net = require("net");
const dns = require("dns");
const http = require("http");
const https = require("https");
const { URL } = require("url");

// ============================================================================
// 1. IP SUBNET CALCULATOR & FORBIDDEN IP MATCHING
// ============================================================================

/**
 * Parses an IPv4 dotted string or alternate numeric representation into an unsigned 32-bit int.
 * Returns null if invalid.
 */
function parseIpv4ToNumber(rawIp) {
  if (!rawIp || typeof rawIp !== "string") return null;
  const s = rawIp.trim();

  // 1. Single decimal, hex, or octal integer representation (e.g. 2130706433 or 0x7f000001)
  if (/^0x[0-9a-f]+$/i.test(s)) {
    const val = parseInt(s, 16);
    if (!isNaN(val) && val >= 0 && val <= 0xffffffff) return val >>> 0;
  }
  if (/^0[0-7]+$/.test(s)) {
    const val = parseInt(s, 8);
    if (!isNaN(val) && val >= 0 && val <= 0xffffffff) return val >>> 0;
  }
  if (/^\d+$/.test(s)) {
    const val = parseInt(s, 10);
    if (!isNaN(val) && val >= 0 && val <= 0xffffffff) return val >>> 0;
  }

  // 2. Dotted parts (1 to 4 parts, e.g. 127.0.0.1, 127.1, 0177.0.0.1, 0x7f.0.0.1)
  const parts = s.split(".");
  if (parts.length >= 1 && parts.length <= 4) {
    const numbers = [];
    for (const part of parts) {
      let num;
      if (/^0x[0-9a-f]+$/i.test(part)) num = parseInt(part, 16);
      else if (/^0[0-7]+$/.test(part)) num = parseInt(part, 8);
      else if (/^\d+$/.test(part)) num = parseInt(part, 10);
      else return null;

      if (isNaN(num) || num < 0) return null;
      numbers.push(num);
    }

    if (numbers.length === 4) {
      if (numbers.some((n) => n > 255)) return null;
      return (((numbers[0] << 24) | (numbers[1] << 16) | (numbers[2] << 8) | numbers[3]) >>> 0);
    } else if (numbers.length === 2) {
      // e.g. 127.1 -> 127.0.0.1 (a.b -> a.0.0.b)
      if (numbers[0] > 255 || numbers[1] > 0xffffff) return null;
      return (((numbers[0] << 24) | numbers[1]) >>> 0);
    } else if (numbers.length === 3) {
      // e.g. 127.0.1 -> 127.0.0.1 (a.b.c -> a.b.0.c)
      if (numbers[0] > 255 || numbers[1] > 255 || numbers[2] > 0xffff) return null;
      return (((numbers[0] << 24) | (numbers[1] << 16) | numbers[2]) >>> 0);
    }
  }

  return null;
}

/**
 * Checks if a 32-bit IPv4 integer falls within a CIDR subnet.
 */
function isIpv4InCidr(ipNum, networkStr, prefixLength) {
  const netNum = parseIpv4ToNumber(networkStr);
  if (netNum === null) return false;
  const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

// Canonical IPv4 Subnets to block
const FORBIDDEN_IPV4_CIDRS = [
  { network: "127.0.0.0", prefix: 8, reason: "IPv4 loopback (127.0.0.0/8) - forbidden private target" },
  { network: "0.0.0.0", prefix: 8, reason: "Current network (0.0.0.0/8) - forbidden private target" },
  { network: "10.0.0.0", prefix: 8, reason: "Private RFC 1918 Class A (10.0.0.0/8) - forbidden private network" },
  { network: "172.16.0.0", prefix: 12, reason: "Private RFC 1918 Class B (172.16.0.0/12) - forbidden private network" },
  { network: "192.168.0.0", prefix: 16, reason: "Private RFC 1918 Class C (192.168.0.0/16) - forbidden private network" },
  { network: "169.254.0.0", prefix: 16, reason: "Link-Local / Cloud Metadata (169.254.0.0/16) - forbidden private/metadata network" },
  { network: "100.64.0.0", prefix: 10, reason: "Carrier-Grade NAT RFC 6598 (100.64.0.0/10) - forbidden private network" },
  { network: "192.0.0.0", prefix: 24, reason: "IETF Protocol Assignments (192.0.0.0/24) - forbidden target" },
  { network: "192.0.2.0", prefix: 24, reason: "Documentation TEST-NET-1 (192.0.2.0/24) - forbidden target" },
  { network: "198.51.100.0", prefix: 24, reason: "Documentation TEST-NET-2 (198.51.100.0/24) - forbidden target" },
  { network: "203.0.113.0", prefix: 24, reason: "Documentation TEST-NET-3 (203.0.113.0/24) - forbidden target" },
  { network: "198.18.0.0", prefix: 15, reason: "Network Interconnect Benchmarking (198.18.0.0/15) - forbidden target" },
  { network: "224.0.0.0", prefix: 4, reason: "Multicast (224.0.0.0/4) - forbidden target" },
  { network: "240.0.0.0", prefix: 4, reason: "Reserved / Future Use (240.0.0.0/4) - forbidden target" },
  { network: "255.255.255.255", prefix: 32, reason: "Limited Broadcast (255.255.255.255/32) - forbidden target" },
];

// Specific known cloud metadata IPv4 addresses
const CLOUD_METADATA_IPV4S = new Set([
  "169.254.169.254", // AWS, GCP, Azure, OpenStack, DigitalOcean
  "169.254.169.253", // AWS DNS
  "169.254.170.2",   // AWS ECS Task Metadata
  "100.100.100.200", // Alibaba Cloud metadata
]);

/**
 * Checks if an IPv6 address string is forbidden or maps to a forbidden IPv4 address.
 */
function checkForbiddenIpv6(rawIpv6) {
  let clean = rawIpv6.toLowerCase().trim();
  if (clean.startsWith("[") && clean.endsWith("]")) {
    clean = clean.slice(1, -1);
  }

  // IPv6 Loopback and Unspecified
  if (clean === "::1" || clean === "0:0:0:0:0:0:0:1") {
    return { forbidden: true, reason: "IPv6 loopback (::1)" };
  }
  if (clean === "::" || clean === "0:0:0:0:0:0:0:0") {
    return { forbidden: true, reason: "IPv6 unspecified (::)" };
  }

  // IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  const mappedMatchDotted = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedMatchDotted) {
    const ipv4Check = checkForbiddenIp(mappedMatchDotted[1]);
    if (ipv4Check.forbidden) {
      return { forbidden: true, reason: `IPv4-mapped IPv6 restricted address: ${ipv4Check.reason}` };
    }
  }

  const mappedMatchHex = clean.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedMatchHex) {
    const high = parseInt(mappedMatchHex[1], 16);
    const low = parseInt(mappedMatchHex[2], 16);
    const dottedIpv4 = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
    const ipv4Check = checkForbiddenIp(dottedIpv4);
    if (ipv4Check.forbidden) {
      return { forbidden: true, reason: `IPv4-mapped IPv6 restricted address (${dottedIpv4}): ${ipv4Check.reason}` };
    }
  }

  // IPv6 Link-Local: fe80::/10 (fe80:: - febf::)
  if (/^fe[89ab][0-9a-f]:/i.test(clean) || clean.startsWith("fe80:")) {
    return { forbidden: true, reason: "IPv6 link-local (fe80::/10)" };
  }

  // IPv6 Unique Local Address (ULA): fc00::/7 (fc00:: - fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(clean) || clean.startsWith("fc00:") || clean.startsWith("fd00:")) {
    // Check specific AWS metadata IPv6 (fd00:ec2::254)
    if (clean.includes("fd00:ec2::254") || clean.startsWith("fd00:ec2:")) {
      return { forbidden: true, reason: "Cloud metadata IPv6 (fd00:ec2::254)" };
    }
    return { forbidden: true, reason: "IPv6 unique local address ULA (fc00::/7)" };
  }

  // IPv6 Multicast: ff00::/8
  if (/^ff[0-9a-f]{2}:/i.test(clean) || clean.startsWith("ff00:")) {
    return { forbidden: true, reason: "IPv6 multicast (ff00::/8)" };
  }

  // Documentation: 2001:db8::/32
  if (clean.startsWith("2001:db8:") || clean.startsWith("2001:0db8:")) {
    return { forbidden: true, reason: "IPv6 documentation prefix (2001:db8::/32)" };
  }

  // NAT64 prefix 64:ff9b::/96
  if (clean.startsWith("64:ff9b::")) {
    const natMatchHex = clean.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (natMatchHex) {
      const high = parseInt(natMatchHex[1], 16);
      const low = parseInt(natMatchHex[2], 16);
      const dottedIpv4 = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
      const ipv4Check = checkForbiddenIp(dottedIpv4);
      if (ipv4Check.forbidden) {
        return { forbidden: true, reason: `IPv6 NAT64 restricted address (${dottedIpv4}): ${ipv4Check.reason}` };
      }
      return { forbidden: false };
    }

    const natMatchDotted = clean.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/i);
    if (natMatchDotted) {
      const ipv4Check = checkForbiddenIp(natMatchDotted[1]);
      if (ipv4Check.forbidden) {
        return { forbidden: true, reason: `IPv6 NAT64 restricted address: ${ipv4Check.reason}` };
      }
      return { forbidden: false };
    }

    return { forbidden: true, reason: "IPv6 NAT64 prefix with unparseable embedded IPv4" };
  }

  return { forbidden: false };
}

/**
 * Checks if an IP address string (IPv4 or IPv6) is forbidden.
 * Returns { forbidden: boolean, reason?: string }.
 */
function checkForbiddenIp(ipStr) {
  if (!ipStr || typeof ipStr !== "string") {
    return { forbidden: true, reason: "Invalid empty or non-string IP" };
  }

  const clean = ipStr.trim().replace(/^\[|\]$/g, "");

  // 1. Check if IPv6
  if (clean.includes(":")) {
    return checkForbiddenIpv6(clean);
  }

  // 2. Specific Cloud Metadata IPs
  if (CLOUD_METADATA_IPV4S.has(clean)) {
    return { forbidden: true, reason: `Cloud metadata endpoint (${clean})` };
  }

  // 3. Parse IPv4 (including alternate decimal/hex/octal representations)
  const ipNum = parseIpv4ToNumber(clean);
  if (ipNum === null) {
    // If not a valid IPv4 and not an IPv6, treat as non-IP or invalid
    return { forbidden: false };
  }

  // 4. Test against all forbidden IPv4 CIDR blocks
  for (const cidr of FORBIDDEN_IPV4_CIDRS) {
    if (isIpv4InCidr(ipNum, cidr.network, cidr.prefix)) {
      return { forbidden: true, reason: cidr.reason };
    }
  }

  return { forbidden: false };
}

/**
 * Boolean helper for convenience.
 */
function isForbiddenIp(ipStr) {
  return checkForbiddenIp(ipStr).forbidden;
}

// ============================================================================
// 2. FORBIDDEN HOSTNAME & INTERNAL DNS MATCHING
// ============================================================================

const FORBIDDEN_HOSTNAMES_EXACT = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "metadata.azure.com",
]);

// Internal and reserved top-level and second-level domains
const FORBIDDEN_DNS_SUFFIXES = [
  ".local",
  ".internal",
  ".corp",
  ".lan",
  ".home",
  ".home.arpa",
  ".intranet",
  ".priv",
  ".private",
  ".test",
  ".invalid",
  ".onion",
  ".localhost",
];

// Well-known dynamic DNS services used to bypass string filters to reach loopback/private IPs
const SUSPICIOUS_DYNAMIC_DNS_PATTERNS = [
  /\.nip\.io$/i,
  /\.sslip\.io$/i,
  /\.localtest\.me$/i,
  /\.vcap\.me$/i,
  /\.lvh\.me$/i,
];

/**
 * Checks if a hostname matches forbidden local, internal, or cloud metadata names.
 * Returns { forbidden: boolean, reason?: string }.
 */
function checkForbiddenHostname(rawHostname) {
  if (!rawHostname || typeof rawHostname !== "string") {
    return { forbidden: true, reason: "Hostname must be a non-empty string" };
  }

  let host = rawHostname.trim().toLowerCase();

  // Strip brackets from IPv6 hostnames
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }

  // Reject null bytes and path separators in hostnames
  if (host.includes("\x00") || host.includes("/") || host.includes("\\")) {
    return { forbidden: true, reason: "Hostname contains illegal characters or path separators" };
  }

  // 1. Exact match
  if (FORBIDDEN_HOSTNAMES_EXACT.has(host)) {
    return { forbidden: true, reason: `Forbidden hostname: '${host}'` };
  }

  // 2. Internal DNS suffixes (.local, .internal, .corp, etc.)
  for (const suffix of FORBIDDEN_DNS_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      return { forbidden: true, reason: `Forbidden internal DNS target ending in '${suffix}'` };
    }
  }

  // 3. Direct IP format check in hostname (e.g. 127.0.0.1, 0177.0.0.1, 2130706433)
  const ipCheck = checkForbiddenIp(host);
  if (ipCheck.forbidden) {
    return { forbidden: true, reason: `Hostname resolves to restricted IP range: ${ipCheck.reason}` };
  }

  return { forbidden: false };
}

function isForbiddenHostname(hostname) {
  return checkForbiddenHostname(hostname).forbidden;
}

// ============================================================================
// 3. ASYNCHRONOUS DNS RESOLUTION & TARGET VALIDATION
// ============================================================================

/**
 * Resolves a hostname or IP address via DNS, verifies that every resolved address
 * is safe, and returns the pinned IP for anti-rebinding connection.
 *
 * @param {string} target - Hostname, IP, or host:port
 * @param {object} [options={}]
 * @param {number} [options.defaultPort=443]
 * @param {boolean} [options.allowPrivate=false]
 * @param {Function} [options.dnsLookupFn] - Optional mockable DNS lookup function
 * @returns {Promise<{ valid: boolean, hostname: string, port: number, resolvedIps: string[], pinnedIp: string, error?: string }>}
 */
async function resolveAndValidateTarget(target, options = {}) {
  const {
    defaultPort = 443,
    allowPrivate = false,
    dnsLookupFn = dns.promises.lookup,
  } = options;

  if (!target || typeof target !== "string") {
    return { valid: false, error: "Target must be a non-empty string" };
  }

  let cleanTarget = target.trim();

  // Strip URL scheme if passed
  try {
    if (cleanTarget.startsWith("http://") || cleanTarget.startsWith("https://")) {
      const parsed = new URL(cleanTarget);
      cleanTarget = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    }
  } catch {}

  // Parse host and port
  let hostname = cleanTarget;
  let port = defaultPort;

  if (cleanTarget.startsWith("[")) {
    // Bracketed IPv6 e.g. [::1]:8443 or [::1]
    const closeBracket = cleanTarget.indexOf("]");
    if (closeBracket === -1) {
      return { valid: false, error: "Malformed bracketed IPv6 target" };
    }
    hostname = cleanTarget.slice(1, closeBracket);
    const remainder = cleanTarget.slice(closeBracket + 1);
    if (remainder.startsWith(":")) {
      port = parseInt(remainder.slice(1), 10) || defaultPort;
    }
  } else if (cleanTarget.includes(":")) {
    const parts = cleanTarget.split(":");
    if (parts.length === 2) {
      hostname = parts[0];
      port = parseInt(parts[1], 10) || defaultPort;
    }
  }

  if (!hostname) {
    return { valid: false, error: "Target hostname cannot be empty" };
  }

  if (port < 1 || port > 65535 || isNaN(port)) {
    return { valid: false, error: `Invalid port number: ${port}` };
  }

  // 1. Validate hostname against forbidden patterns
  if (!allowPrivate) {
    const hostCheck = checkForbiddenHostname(hostname);
    if (hostCheck.forbidden) {
      return { valid: false, error: hostCheck.reason, hostname, port };
    }
  } else {
    // Cloud metadata hostnames must NEVER be allowed under any circumstances
    if (FORBIDDEN_HOSTNAMES_EXACT.has(hostname)) {
      return { valid: false, error: `Cloud metadata hostname '${hostname}' is strictly prohibited`, hostname, port };
    }
  }

  // 2. Check if hostname is an IP literal
  const isDirectIp = net.isIP(hostname);
  if (isDirectIp) {
    const ipCheck = checkForbiddenIp(hostname);
    if (ipCheck.forbidden) {
      if (!allowPrivate || CLOUD_METADATA_IPV4S.has(hostname) || hostname.includes("169.254.") || hostname.includes("fd00:ec2:")) {
        return {
          valid: false,
          error: `IP address belongs to restricted range: ${ipCheck.reason}`,
          hostname,
          port,
          resolvedIps: [hostname],
        };
      }
    }
    return {
      valid: true,
      hostname,
      port,
      resolvedIps: [hostname],
      pinnedIp: hostname,
    };
  }

  // 3. Resolve DNS for hostname (IPv4 and IPv6)
  let lookupResults;
  try {
    lookupResults = await dnsLookupFn(hostname, { all: true });
  } catch (dnsErr) {
    return {
      valid: false,
      error: `DNS resolution failed for '${hostname}': ${dnsErr.message}`,
      hostname,
      port,
    };
  }

  if (!lookupResults || !Array.isArray(lookupResults) || lookupResults.length === 0) {
    return {
      valid: false,
      error: `No IP addresses found for host '${hostname}'`,
      hostname,
      port,
    };
  }

  const resolvedIps = [...new Set(lookupResults.map((r) => r.address))];

  // 4. DNS Rebinding Guard: Verify that ALL resolved IPs are safe
  for (const ip of resolvedIps) {
    const ipCheck = checkForbiddenIp(ip);
    if (ipCheck.forbidden) {
      if (!allowPrivate || CLOUD_METADATA_IPV4S.has(ip) || ip.includes("169.254.") || ip.includes("fd00:ec2:")) {
        return {
          valid: false,
          error: `DNS resolution for '${hostname}' returned restricted address ${ip} (${ipCheck.reason})`,
          hostname,
          port,
          resolvedIps,
        };
      }
    }
  }

  // 5. Pin the first validated IP address
  const pinnedIp = resolvedIps[0];

  return {
    valid: true,
    hostname,
    port,
    resolvedIps,
    pinnedIp,
  };
}

// ============================================================================
// 4. SAFE URL & SAFE GIT URL VALIDATION
// ============================================================================

/**
 * Validates a web URL against SSRF with DNS resolution and anti-rebinding.
 */
async function validateSafeUrlAsync(rawUrl, options = {}) {
  const {
    allowedProtocols = ["http:", "https:"],
    allowLocalhost = false,
    allowPrivate = false,
    dnsLookupFn = dns.promises.lookup,
  } = options;

  if (!rawUrl || typeof rawUrl !== "string") {
    return { safe: false, error: "URL must be a non-empty string" };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { safe: false, error: "Malformed URL format" };
  }

  // 1. Protocol validation
  const protocol = parsed.protocol.toLowerCase();
  if (!allowedProtocols.includes(protocol)) {
    return {
      safe: false,
      error: `Protocol '${parsed.protocol}' is prohibited. Allowed: ${allowedProtocols.join(", ")}`,
    };
  }

  // 2. Reject credentials in URL
  if (parsed.username || parsed.password) {
    return { safe: false, error: "Embedded credentials in URLs are prohibited" };
  }

  // 3. Reject Unix sockets and file paths
  if (protocol === "file:" || protocol === "unix:" || rawUrl.toLowerCase().startsWith("http+unix://")) {
    return { safe: false, error: "Unix sockets and file URIs are prohibited" };
  }

  const hostname = parsed.hostname;
  const port = parsed.port ? parseInt(parsed.port, 10) : (protocol === "http:" ? 80 : 443);

  // 4. Resolve and validate destination IP(s)
  const targetCheck = await resolveAndValidateTarget(`${hostname}:${port}`, {
    defaultPort: port,
    allowPrivate: allowPrivate || allowLocalhost,
    dnsLookupFn,
  });

  if (!targetCheck.valid) {
    return { safe: false, error: targetCheck.error, url: parsed };
  }

  return {
    safe: true,
    url: parsed,
    hostname: targetCheck.hostname,
    port: targetCheck.port,
    resolvedIps: targetCheck.resolvedIps,
    pinnedIp: targetCheck.pinnedIp,
  };
}

/**
 * Validates a Git clone URL against command injection, dangerous protocols,
 * and SSRF destinations.
 */
async function validateSafeGitUrlAsync(rawGitUrl, options = {}) {
  const { allowPrivate = false, dnsLookupFn = dns.promises.lookup } = options;

  if (!rawGitUrl || typeof rawGitUrl !== "string") {
    return { safe: false, error: "Git repository URL must be a non-empty string" };
  }

  let clean = rawGitUrl.trim();

  // Reject command injection characters, null bytes, newlines, and option injection
  if (/[\x00\r\n;`$|&]/.test(clean)) {
    return { safe: false, error: "Git URL contains illegal shell metacharacters or control bytes" };
  }

  if (clean.startsWith("-") || clean.startsWith("--")) {
    return { safe: false, error: "Git URL cannot start with '-' (option injection defense)" };
  }

  // Reject local file schemes, relative paths, and Windows drive/UNC paths
  if (
    clean.startsWith("file://") ||
    clean.startsWith("ext::") ||
    clean.startsWith("fd::") ||
    clean.startsWith("/") ||
    clean.startsWith("./") ||
    clean.startsWith("../") ||
    /^[a-zA-Z]:[\\/]/.test(clean) ||
    clean.startsWith("\\\\")
  ) {
    return { safe: false, error: "Local filesystem paths and dangerous Git helper protocols are prohibited" };
  }

  // Extract hostname from various Git URL formats:
  // - https://github.com/owner/repo.git
  // - git@github.com:owner/repo.git
  // - ssh://git@github.com/owner/repo.git
  let hostname = null;
  let defaultPort = 443;

  if (clean.startsWith("https://") || clean.startsWith("http://")) {
    try {
      const parsed = new URL(clean);
      if ((parsed.username || parsed.password) && !options.allowCredentials) {
        return {
          safe: false,
          error: "Embedded credentials in Git repository URLs are prohibited unless explicitly authorized.",
        };
      }
      if (parsed.username || parsed.password) {
        parsed.username = "";
        parsed.password = "";
        clean = parsed.toString();
      }
      hostname = parsed.hostname;
      defaultPort = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === "http:" ? 80 : 443);
    } catch {
      return { safe: false, error: "Malformed HTTP/HTTPS Git repository URL" };
    }
  } else if (clean.startsWith("git@")) {
    // git@hostname:owner/repo.git
    const match = clean.match(/^git@([^:/]+):/);
    if (match) {
      hostname = match[1];
      defaultPort = 22;
    } else {
      return { safe: false, error: "Malformed SCP-style Git URL format" };
    }
  } else if (clean.startsWith("ssh://")) {
    try {
      const parsed = new URL(clean);
      hostname = parsed.hostname;
      defaultPort = parsed.port ? parseInt(parsed.port, 10) : 22;
    } catch {
      return { safe: false, error: "Malformed SSH Git URL format" };
    }
  } else if (clean.startsWith("git://")) {
    try {
      const parsed = new URL(clean);
      hostname = parsed.hostname;
      defaultPort = parsed.port ? parseInt(parsed.port, 10) : 9418;
    } catch {
      return { safe: false, error: "Malformed Git protocol URL format" };
    }
  } else if (clean.includes("github.com") || clean.includes("gitlab.com") || clean.includes("bitbucket.org")) {
    // Bare domain repo like github.com/owner/repo
    const parts = clean.split("/");
    hostname = parts[0];
    defaultPort = 443;
  } else {
    return {
      safe: false,
      error: `Prohibited Git repository format '${clean}'. Allowed: https://, http://, git@, ssh://`,
    };
  }

  if (!hostname) {
    return { safe: false, error: "Unable to determine remote Git hostname" };
  }

  // Resolve and validate destination hostname
  const targetCheck = await resolveAndValidateTarget(hostname, {
    defaultPort,
    allowPrivate,
    dnsLookupFn,
  });

  if (!targetCheck.valid) {
    return { safe: false, error: `Git remote target rejected: ${targetCheck.error}` };
  }

  return {
    safe: true,
    normalizedUrl: clean,
    hostname: targetCheck.hostname,
    port: targetCheck.port,
    resolvedIps: targetCheck.resolvedIps,
    pinnedIp: targetCheck.pinnedIp,
  };
}

// ============================================================================
// 5. ANTI-REBINDING SAFE HTTP FETCH WRAPPER
// ============================================================================

/**
 * Executes an HTTP/HTTPS request with address pinning to defeat DNS Rebinding (TOCTOU) attacks.
 *
 * 1. Resolves and validates target destination upfront.
 * 2. Injects custom DNS lookup handler pinning the connection directly to the validated IP.
 * 3. Preserves TLS Server Name Indication (SNI) and Host header for virtual hosts and cert validation.
 * 4. Intercepts and validates HTTP 3xx redirect locations.
 */
async function safeFetch(rawUrl, options = {}) {
  const {
    method = "GET",
    headers = {},
    body = null,
    timeoutMs = 15000,
    maxRedirects = 5,
    maxResponseSizeBytes = 50 * 1024 * 1024, // 50 MB response size cap
    allowPrivate = false,
    dnsLookupFn = dns.promises.lookup,
  } = options;

  let currentUrl = rawUrl;
  let redirectsCount = 0;

  while (redirectsCount <= maxRedirects) {
    // Step 1: Validate URL and resolve destination IP (before and after DNS resolution)
    const urlValidation = await validateSafeUrlAsync(currentUrl, {
      allowPrivate,
      dnsLookupFn,
    });

    if (!urlValidation.safe) {
      throw new Error(`SSRF Blocked: ${urlValidation.error}`);
    }

    const { url: parsed, hostname, pinnedIp, port } = urlValidation;
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const requestHeaders = { ...headers };
    if (!requestHeaders["Host"]) {
      requestHeaders["Host"] = hostname + (parsed.port ? `:${parsed.port}` : "");
    }

    // Step 2: Perform HTTP request with custom pinned lookup
    const response = await new Promise((resolve, reject) => {
      const reqOptions = {
        method,
        hostname: pinnedIp, // Connect directly to pinned IP
        port,
        path: parsed.pathname + parsed.search,
        headers: requestHeaders,
        timeout: timeoutMs,
        // Pin DNS lookup to prevent any secondary resolution
        lookup: (_host, _opts, callback) => {
          callback(null, pinnedIp, net.isIP(pinnedIp));
        },
      };

      if (isHttps) {
        // Preserve original SNI hostname for TLS handshake certificate validation
        reqOptions.servername = hostname;
      }

      let totalBytesReceived = 0;
      let aborted = false;

      const clientReq = transport.request(reqOptions, (res) => {
        const chunks = [];
        res.on("data", (chunk) => {
          if (aborted) return;
          totalBytesReceived += chunk.length;
          if (totalBytesReceived > maxResponseSizeBytes) {
            aborted = true;
            clientReq.destroy();
            reject(new Error(`Response size limit exceeded: Received more than ${maxResponseSizeBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (aborted) return;
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            buffer,
            text: () => Promise.resolve(buffer.toString("utf8")),
            json: () => Promise.resolve(JSON.parse(buffer.toString("utf8"))),
            ok: res.statusCode >= 200 && res.statusCode < 300,
          });
        });
      });

      clientReq.on("timeout", () => {
        aborted = true;
        clientReq.destroy();
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      });

      clientReq.on("error", (err) => {
        if (!aborted) {
          reject(err);
        }
      });

      if (body) {
        clientReq.write(body);
      }
      clientReq.end();
    });

    // Step 3: Handle 3xx redirects securely
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers["location"];
      if (!location) {
        return response;
      }

      redirectsCount++;
      if (redirectsCount > maxRedirects) {
        throw new Error(`Too many redirects (limit: ${maxRedirects})`);
      }

      // Resolve relative redirect against current URL and re-validate on next iteration
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return response;
  }

  throw new Error(`Too many redirects (limit: ${maxRedirects})`);
}

module.exports = {
  // IP & Subnet Checking
  parseIpv4ToNumber,
  isIpv4InCidr,
  checkForbiddenIp,
  isForbiddenIp,
  checkForbiddenIpv6,
  FORBIDDEN_IPV4_CIDRS,
  CLOUD_METADATA_IPV4S,

  // Hostname & Internal Target Checking
  checkForbiddenHostname,
  isForbiddenHostname,
  FORBIDDEN_HOSTNAMES_EXACT,
  FORBIDDEN_DNS_SUFFIXES,

  // Async Resolution & Target Validation
  resolveAndValidateTarget,
  validateSafeUrlAsync,
  validateSafeGitUrlAsync,

  // Rebinding-safe outbound client
  safeFetch,
};
