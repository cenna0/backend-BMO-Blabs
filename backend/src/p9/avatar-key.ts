const avatarKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isAvatarKey(value: string): boolean {
  return avatarKeyPattern.test(value);
}

export function parseAvatarFileName(value: string): string | null {
  if (!value.endsWith(".webp")) return null;
  const key = value.slice(0, -".webp".length);
  return isAvatarKey(key) ? key : null;
}

export function avatarUrl(publicBaseUrl: string, key: string): string | null {
  if (!isAvatarKey(key)) return null;
  try {
    return new URL(`/media/avatars/${key}.webp`, publicBaseUrl).toString();
  } catch {
    return null;
  }
}
