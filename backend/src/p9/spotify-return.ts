export const DEFAULT_SPOTIFY_CLIENT_RETURN = "bmomobile://plugin-detail?id=spotify";

const ALLOWED_PROTOCOLS = new Set(["bmomobile:", "exp:", "exps:"]);

export function sanitizeSpotifyClientReturnUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    return DEFAULT_SPOTIFY_CLIENT_RETURN;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return DEFAULT_SPOTIFY_CLIENT_RETURN;
  }
  if (parsed.username || parsed.password) {
    return DEFAULT_SPOTIFY_CLIENT_RETURN;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return DEFAULT_SPOTIFY_CLIENT_RETURN;
  }
  return value;
}

export function spotifyClientReturnHtml(returnTo: string, ok: boolean, detail?: string): string {
  const url = sanitizeSpotifyClientReturnUrl(returnTo);
  const href = url.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;");
  const message = ok ? "Spotify connected. Returning to BMO." : "Spotify connection failed. Returning to BMO.";
  const extra = !ok && detail ? `<p>${detail.replace(/&/gu, "&amp;").replace(/</gu, "&lt;")}</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BMO</title></head><body><p>${message}</p>${extra}<p><a href="${href}">Open BMO</a></p><script>location.replace(${JSON.stringify(url)});</script></body></html>`;
}
