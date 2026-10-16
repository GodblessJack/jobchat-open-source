// jchat/server/lib/ipv4-only.ts
//
// Force IPv4 for all outbound network calls in the *current* Node process.
// Loaded by the SDK worker before the SDK CLI subprocess is spawned.
//
// Why: Node 22+ "happy eyeballs" tries IPv6 first, which on servers without
// IPv6 outbound causes ~10s timeouts on every cold call. We patch dns/net/tls
// to force IPv4 family.
//
// This is a port of clay/lib/ipv4-only.js; behavior is identical.
//
// NOTE: written as a side-effect module — `import './lib/ipv4-only.js'` once
// to apply the patches.

import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';


const _dns = dns as any;
const _net = net as any;
const _tls = tls as any;

// 1) Force dns.lookup to only return IPv4 addresses.
const origLookup = _dns.lookup;
_dns.lookup = function patchedLookup(hostname: string, options: any, callback?: any) {
  let opts: any;
  let cb: any;
  if (typeof options === 'function') {
    cb = options;
    opts = {};
  } else if (typeof options === 'number') {
    opts = { family: options };
    cb = callback;
  } else {
    opts = options || {};
    cb = callback;
  }
  opts.family = 4;
  return origLookup.call(_dns, hostname, opts, cb);
};

try {
  _dns.setDefaultResultOrder?.('ipv4first');
} catch {
  /* older Node — ignore */
}

// 2) Disable autoSelectFamily at net level.
try {
  _net.setDefaultAutoSelectFamily?.(false);
} catch {
  /* ignore */
}

// 3) Patch net.connect / net.createConnection to force family:4.
function patchOpts(args: unknown[]): unknown[] {
  if (args[0] && typeof args[0] === 'object') {
    const o = args[0] as Record<string, unknown>;
    o.family = 4;
    o.autoSelectFamily = false;
  }
  return args;
}

const origNetConnect = _net.connect.bind(_net);
_net.connect = function patchedConnect(...args: unknown[]) {
  return origNetConnect(...patchOpts(args));
};

const origCreateConnection = _net.createConnection.bind(_net);
_net.createConnection = function patchedCreateConnection(...args: unknown[]) {
  return origCreateConnection(...patchOpts(args));
};

// 4) Patch tls.connect (undici uses this for HTTPS).
const origTlsConnect = _tls.connect.bind(_tls);
_tls.connect = function patchedTlsConnect(...args: unknown[]) {
  return origTlsConnect(...patchOpts(args));
};

export {}; // ensure ES-module shape
