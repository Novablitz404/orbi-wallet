'use client';

// Runs the Buffer BigInt64 polyfill in the browser before any stellar-sdk
// XDR deserialization. Imported as a side-effect at module load.
import '../lib/polyfills';

export default function BufferPolyfill() {
  return null;
}
