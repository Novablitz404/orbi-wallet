import type { NextConfig } from "next";

// Baseline security headers (safe to enforce; no functionality impact). The
// strict Content-Security-Policy is intentionally NOT set here — Next's inline
// bootstrap scripts need a nonce-based CSP via middleware, which must be verified
// on a preview deploy before prod (a wrong CSP blanks the app). WebAuthn
// (publickey-credentials-*) is left at its default ('self') so passkeys keep
// working on the keys origin.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' }, // pages are top-level popups, never framed
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    return [
      {
        source: '/',
        has: [{ type: 'host', value: 'keys.orbiwallet.xyz' }],
        destination: 'https://account.orbiwallet.xyz',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
