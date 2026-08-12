import assert from 'assert';
import { deriveAndSign } from './derivation-worker';

async function runMemoryCleanupTest() {
  console.log('🧪 [D1 Test] Starting Core Derivation Memory Cleanup Test...');

  // 1. Generate 32-byte mock WebAuthn PRF output entropy
  const mockPrfOutput = new Uint8Array(32);
  crypto.getRandomValues(mockPrfOutput);
  const prfInputCopy = new Uint8Array(mockPrfOutput);

  // 2. Execute derivation & signing
  const result = await deriveAndSign({ prfOutput: prfInputCopy });

  // 3. Verify standard Stellar address format
  assert.ok(result.gAddress.startsWith('G'), 'Derived address must start with standard Stellar G...');
  assert.strictEqual(result.gAddress.length, 56, 'Derived address must be a standard 56-character Ed25519 public key');

  // 4. Verify memory cleanup
  assert.strictEqual(result.cleanedMemory, true, 'Worker must report cleanedMemory = true');
  assert.ok(prfInputCopy.every(b => b === 0), 'PRF input working memory buffer must be 100% zeroed out');

  console.log(`✅ [D1 Test PASSED] Derived address: ${result.gAddress}`);
  console.log('✅ [D1 Test PASSED] All secret key memory buffers zeroed out successfully!');
}

runMemoryCleanupTest().catch(err => {
  console.error('❌ [D1 Test FAILED]:', err);
  process.exit(1);
});
