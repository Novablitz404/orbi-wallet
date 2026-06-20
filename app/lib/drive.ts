// Google Drive appDataFolder I/O for the encrypted Cloud share B — via REST with
// the browser-held access token (no hosted Drive JS). appDataFolder is an
// app-private, user-invisible folder. B is stored already-encrypted (K_B), so
// even a Google-account breach yields only ciphertext.
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function findFileId(token: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${name}' and 'appDataFolder' in parents and trashed=false`);
  const res = await fetch(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id,name)`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`drive list failed: ${res.status}`);
  const j = (await res.json()) as { files?: { id: string }[] };
  return j.files?.[0]?.id ?? null;
}

/** Create or overwrite a small text file in appDataFolder. */
export async function writeAppData(token: string, name: string, content: string): Promise<void> {
  const existing = await findFileId(token, name);
  const boundary = 'orbi' + Math.random().toString(36).slice(2);
  const metadata = existing ? {} : { name, parents: ['appDataFolder'] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const url = existing
    ? `${UPLOAD}/files/${existing}?uploadType=multipart`
    : `${UPLOAD}/files?uploadType=multipart`;
  const res = await fetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`drive upload failed: ${res.status} ${await res.text()}`);
}

/** Read a text file from appDataFolder, or null if absent. */
export async function readAppData(token: string, name: string): Promise<string | null> {
  const id = await findFileId(token, name);
  if (!id) return null;
  const res = await fetch(`${DRIVE}/files/${id}?alt=media`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`drive download failed: ${res.status}`);
  return res.text();
}
