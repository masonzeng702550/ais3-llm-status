/** Join a path onto Astro's configured base, which differs between github.io and a custom domain. */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base}/${path}`.replace(/\/{2,}/g, '/');
}
