// Fully signs the user out of their Orbi wallet — not just this site's
// connection to it (that's what `orbi.disconnect()` is for). The underlying
// wallet session lives on keys.orbiwallet.xyz's own localStorage, which this
// origin can't reach directly, so we run the clear over there via a popup +
// postMessage handshake (same pattern as the SDK's connect flow) and wait for
// confirmation before the caller proceeds.

const KEYS_URL = 'https://keys.orbiwallet.xyz';
const KEYS_ORIGIN = new URL(KEYS_URL).origin;

export function fullWalletSignOut(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const popup = window.open(`${KEYS_URL}/signout`, 'orbi-signout', 'width=1,height=1');
  if (!popup) return Promise.resolve(); // popup blocked — fall back to a local-only disconnect

  return new Promise<void>((resolve) => {
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedCheck);
      resolve();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== KEYS_ORIGIN) return;
      if (event.source !== null && event.source !== popup) return;
      const data = event.data as { type?: string };
      if (data?.type === 'orbi_signed_out') settle();
    };

    // If the popup closes before confirming (or never confirms), don't block
    // the caller forever — proceed with whatever local cleanup it still does.
    const closedCheck = setInterval(() => {
      if (popup.closed) settle();
    }, 250);

    window.addEventListener('message', onMessage);
  });
}
