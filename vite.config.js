import { defineConfig } from 'vite';

// The satellite scale is a plain three.js globe (src/satellite.js) — no Cesium,
// so no imagery tiles, tokens, or asset-copying plugin to go wrong.
//
// `base` is '/' in dev but the repo subpath in the production build so the app
// works when served from https://rylekizzo.github.io/crop-health-game/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/crop-health-game/' : '/',
}));
