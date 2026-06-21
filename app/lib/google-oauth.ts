/* eslint-disable @typescript-eslint/no-explicit-any */
// Google Identity Services — runs on the keys origin. Deliberately TWO tokens:
//  - an ID token (identity only, no API scope) → sent to the recovery server to
//    authorize a share release. Grants NO Drive access.
//  - a Drive access token (drive.appdata) → stays in the browser to read/write
//    share B. NEVER sent to the server, so the server can never read B.
// That split is what keeps the design non-custodial. (§6.5 hardening: later move
// this into a sandboxed companion origin so even Google's JS leaves the seed origin.)

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if ((window as any).google?.accounts) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Warm up GIS (load the script) so the consent popup can open synchronously on
 *  click, without a script-load await eating the user activation. Call on mount
 *  of any page with a "Set up recovery" / Google button. Safe to call repeatedly. */
export function prewarmGoogleAuth(): void {
  void loadGis().catch(() => { /* surfaced later when the user actually clicks */ });
}

function clientId(): string {
  const id = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!id) throw new Error('NEXT_PUBLIC_GOOGLE_CLIENT_ID not set');
  return id;
}

/** Identity-only ID token (JWT) for the server to verify. No API access. */
export async function requestGoogleIdToken(): Promise<string> {
  await loadGis();
  const g = (window as any).google;
  return new Promise<string>((resolve, reject) => {
    g.accounts.id.initialize({
      client_id: clientId(),
      callback: (resp: any) =>
        resp?.credential ? resolve(resp.credential) : reject(new Error('no Google credential returned')),
      use_fedcm_for_prompt: true,
    });
    g.accounts.id.prompt((n: any) => {
      if (n?.isNotDisplayed?.() || n?.isSkippedMoment?.()) {
        reject(new Error('Google sign-in prompt not shown — ensure you are an OAuth test user, then retry'));
      }
    });
  });
}

/** Drive access token (drive.appdata). Stays in the browser — never sent to the server. */
export async function requestDriveAccessToken(): Promise<string> {
  await loadGis();
  const g = (window as any).google;
  return new Promise<string>((resolve, reject) => {
    const tc = g.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: 'https://www.googleapis.com/auth/drive.appdata',
      callback: (resp: any) =>
        resp?.access_token ? resolve(resp.access_token) : reject(new Error('no Drive access token returned')),
      error_callback: (err: any) => reject(new Error(err?.message ?? 'Drive token request failed')),
    });
    tc.requestAccessToken();
  });
}
