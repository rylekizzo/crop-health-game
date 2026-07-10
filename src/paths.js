// Resolve a public/ asset path against Vite's base URL, so assets load both at
// the site root (dev / custom domain) and under a GitHub Pages subpath
// (e.g. /crop-health-game/). Pass the path with or without a leading slash.
export const asset = (p) => import.meta.env.BASE_URL + p.replace(/^\//, '');
