// @stellar/js-xdr's XdrReader calls readBigInt64BE / writeBigInt64BE on its
// buffer when (de)serializing Int64/Hyper XDR values (e.g. the auth entry
// nonce). The Buffer that Turbopack bundles for the browser implements the
// 32-bit reads but is missing the 64-bit BigInt methods, causing
// "this._buffer.readBigInt64BE is not a function".
//
// Bulletproof fix: define these methods on Uint8Array.prototype — the common
// ancestor of every Buffer polyfill. Whatever Buffer js-xdr uses, the missing
// method resolves up the prototype chain to here. Implemented via DataView.

type TypedArr = Uint8Array & {
  readBigInt64BE?: (offset?: number) => bigint;
  readBigUInt64BE?: (offset?: number) => bigint;
  readBigInt64LE?: (offset?: number) => bigint;
  readBigUInt64LE?: (offset?: number) => bigint;
  writeBigInt64BE?: (value: bigint, offset?: number) => number;
  writeBigUInt64BE?: (value: bigint, offset?: number) => number;
  writeBigInt64LE?: (value: bigint, offset?: number) => number;
  writeBigUInt64LE?: (value: bigint, offset?: number) => number;
};

function dv(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

function define(proto: TypedArr, name: string, fn: (this: Uint8Array, ...a: never[]) => unknown) {
  if (typeof (proto as unknown as Record<string, unknown>)[name] !== 'function') {
    Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
  }
}

function patch(proto: TypedArr | undefined) {
  if (!proto) return;
  define(proto, 'readBigInt64BE', function (this: Uint8Array, offset = 0) { return dv(this).getBigInt64(offset, false); } as never);
  define(proto, 'readBigUInt64BE', function (this: Uint8Array, offset = 0) { return dv(this).getBigUint64(offset, false); } as never);
  define(proto, 'readBigInt64LE', function (this: Uint8Array, offset = 0) { return dv(this).getBigInt64(offset, true); } as never);
  define(proto, 'readBigUInt64LE', function (this: Uint8Array, offset = 0) { return dv(this).getBigUint64(offset, true); } as never);
  define(proto, 'writeBigInt64BE', function (this: Uint8Array, value: bigint, offset = 0) { dv(this).setBigInt64(offset, value, false); return offset + 8; } as never);
  define(proto, 'writeBigUInt64BE', function (this: Uint8Array, value: bigint, offset = 0) { dv(this).setBigUint64(offset, value, false); return offset + 8; } as never);
  define(proto, 'writeBigInt64LE', function (this: Uint8Array, value: bigint, offset = 0) { dv(this).setBigInt64(offset, value, true); return offset + 8; } as never);
  define(proto, 'writeBigUInt64LE', function (this: Uint8Array, value: bigint, offset = 0) { dv(this).setBigUint64(offset, value, true); return offset + 8; } as never);
}

if (typeof window !== 'undefined') {
  // Common ancestor of all Buffer polyfills — guarantees the method resolves.
  patch(Uint8Array.prototype as TypedArr);

  // Also patch the global Buffer's own prototype if present.
  const g = globalThis as unknown as { Buffer?: { prototype: TypedArr } };
  patch(g.Buffer?.prototype);
}
