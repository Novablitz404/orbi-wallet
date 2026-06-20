'use client';

// Dev-only harness to exercise the A+B recovery loop end-to-end against a local
// recovery server (orbi-recovery-server). Not linked from the app.
//
// Prereqs (local):
//   - orbi-recovery-server running with RP_ID=localhost,
//     EXPECTED_ORIGIN=http://localhost:3000, ALLOWED_ORIGIN=http://localhost:3000,
//     LOCAL_DEV_KEK set, local Postgres migrated.
//   - This app on http://localhost:3000.
//   - Optionally NEXT_PUBLIC_RECOVERY_SERVER_URL (defaults to http://localhost:8080).
import { useState } from 'react';
import { createPRFCredential } from '../../../lib/prf-wallet';
import {
  enrollRecovery,
  reconstructViaPasskey,
  verifyRecovered,
  type EnrollResult,
} from '../../../lib/recovery';

interface Enrolled {
  userId: string;
  credentialId: string;
  encryptedB: EnrollResult['encryptedB'];
  gAddress: string;
  evmAddress: string;
}

export default function RecoveryDevPage() {
  const [log, setLog] = useState<string[]>([]);
  const [enrolled, setEnrolled] = useState<Enrolled | null>(null);
  const [busy, setBusy] = useState(false);

  const say = (m: string) => setLog((l) => [...l, m]);

  async function createAndEnroll() {
    setBusy(true);
    try {
      say('Creating passkey (PRF)…');
      const cred = await createPRFCredential();
      say(`✓ passkey ${cred.credentialId.slice(0, 12)}…  G=${cred.gAddress.slice(0, 8)}…  ${cred.evmAddress.slice(0, 8)}…`);

      say('Splitting seed + enrolling Server share + K_B…');
      const res = await enrollRecovery({
        prfOutput: cred.prfOutput,
        credentialId: cred.credentialId,
        publicKey: cred.publicKey,
        stellarAddress: cred.gAddress,
        evmAddress: cred.evmAddress,
      });
      cred.prfOutput.fill(0);

      setEnrolled({
        userId: res.userId,
        credentialId: cred.credentialId,
        encryptedB: res.encryptedB,
        gAddress: cred.gAddress,
        evmAddress: cred.evmAddress,
      });
      say(`✓ enrolled user ${res.userId}. Encrypted B held locally (stands in for Drive).`);
    } catch (e) {
      say(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function reconstruct() {
    if (!enrolled) return;
    setBusy(true);
    try {
      say('Reconstructing via passkey → challenge → release → unseal → combine…');
      const prfOutput = await reconstructViaPasskey({
        userId: enrolled.userId,
        credentialId: enrolled.credentialId,
        encryptedB: enrolled.encryptedB,
      });
      const ok = await verifyRecovered(prfOutput, {
        gAddress: enrolled.gAddress,
        evmAddress: enrolled.evmAddress,
      });
      prfOutput.fill(0);
      say(ok ? '✓✓ RECOVERED seed matches the wallet addresses.' : '✗ recovered seed does NOT match (bug).');
    } catch (e) {
      say(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: 24, fontFamily: 'system-ui', color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 20 }}>Recovery loop (dev)</h1>
      <p style={{ color: '#94a3b8', fontSize: 13 }}>
        Exercises A+B: split PRF seed → enroll Server share + K_B → reconstruct via passkey release.
      </p>
      <div style={{ display: 'flex', gap: 10, margin: '16px 0' }}>
        <button onClick={createAndEnroll} disabled={busy}
          style={{ padding: '10px 14px', borderRadius: 10, background: '#2563eb', color: '#fff', border: 0, cursor: 'pointer' }}>
          1. Create wallet + enroll
        </button>
        <button onClick={reconstruct} disabled={busy || !enrolled}
          style={{ padding: '10px 14px', borderRadius: 10, background: '#16a34a', color: '#fff', border: 0, cursor: enrolled ? 'pointer' : 'not-allowed', opacity: enrolled ? 1 : 0.5 }}>
          2. Reconstruct via passkey
        </button>
      </div>
      <pre style={{ background: '#0b1424', border: '1px solid #1e293b', borderRadius: 12, padding: 14, fontSize: 12, whiteSpace: 'pre-wrap', minHeight: 160 }}>
        {log.join('\n') || '(log)'}
      </pre>
    </main>
  );
}
