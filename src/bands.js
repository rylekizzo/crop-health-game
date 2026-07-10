import * as THREE from 'three';
import { nirReflectance, canopyTempC, ndvi, ndre, sif } from './healthField.js';

// Wavelength regions (nm) each band/index samples — used by the spectral graph.
export const SPECTRAL_REGIONS = {
  blue: { range: [455, 490], color: '#5a8fd8' },
  green: { range: [520, 570], color: '#5fbf4a' },
  red: { range: [630, 690], color: '#d85a5a' },
  rededge: { range: [700, 745], color: '#d8a040' },
  nir: { range: [760, 885], color: '#b56b6b' },
};
const REG = SPECTRAL_REGIONS;

/**
 * Spectral "bands" the drone sensor can display. Each band turns the latent
 * crop health into a per-plant color, and provides legend data for the UI.
 *
 *   rgb     — true color (what your eye / an RGB camera sees)
 *   nir     — near-infrared reflectance (healthy canopy = bright)
 *   thermal — canopy temperature (water-stressed = hot)
 */

// --- color ramp helpers ----------------------------------------------------

function lerpStops(stops, t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0] || 1);
      return new THREE.Color(
        a[1][0] + (b[1][0] - a[1][0]) * f,
        a[1][1] + (b[1][1] - a[1][1]) * f,
        a[1][2] + (b[1][2] - a[1][2]) * f
      );
    }
  }
  const last = stops[stops.length - 1][1];
  return new THREE.Color(last[0], last[1], last[2]);
}

// Inferno-like thermal ramp (cool/dark → hot/bright).
const INFERNO = [
  [0.0, [0.02, 0.02, 0.18]],
  [0.25, [0.28, 0.07, 0.43]],
  [0.5, [0.62, 0.18, 0.38]],
  [0.75, [0.92, 0.45, 0.13]],
  [1.0, [0.99, 0.92, 0.45]],
];

// True-color ramp: chlorotic yellow (stressed) → vigorous green (healthy).
const TRUECOLOR = [
  [0.0, [0.74, 0.62, 0.24]],
  [0.5, [0.62, 0.66, 0.2]],
  [1.0, [0.26, 0.6, 0.16]],
];

// RdYlGn — the standard vegetation-index palette (red = low, green = high).
const RDYLGN = [
  [0.0, [0.65, 0.0, 0.15]],
  [0.25, [0.96, 0.43, 0.26]],
  [0.5, [1.0, 0.94, 0.55]],
  [0.75, [0.55, 0.78, 0.4]],
  [1.0, [0.0, 0.41, 0.22]],
];

// Viridis-like ramp for SIF (low = dark purple, high = yellow).
const VIRIDIS = [
  [0.0, [0.16, 0.05, 0.28]],
  [0.35, [0.18, 0.32, 0.55]],
  [0.6, [0.13, 0.56, 0.47]],
  [0.82, [0.42, 0.74, 0.28]],
  [1.0, [0.95, 0.9, 0.22]],
];

function cssRgb(c) {
  return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
}

// --- band definitions ------------------------------------------------------

export const BANDS = [
  {
    id: 'rgb',
    key: '1',
    label: 'RGB · true color',
    note: 'Plain color, like your eyes see. Sick plants turn yellow.',
    color: (health) => lerpStops(TRUECOLOR, health),
    // legend: low→high health
    legend: { lo: 'stressed', hi: 'healthy', ramp: (t) => lerpStops(TRUECOLOR, t) },
    spectral: { regions: ['blue', 'green', 'red'] },
  },
  {
    id: 'nir',
    key: '2',
    label: 'NIR · near-infrared',
    note: 'Invisible infrared light. Healthy leaves bounce back a lot of it, so bright = vigorous.',
    color: (health) => {
      const t = (nirReflectance(health) - 0.18) / 0.67; // normalize to 0..1
      return lerpStops(
        [
          [0.0, [0.08, 0.04, 0.04]],
          [0.5, [0.5, 0.32, 0.3]],
          [1.0, [1.0, 0.93, 0.86]],
        ],
        t
      );
    },
    legend: {
      lo: '0.18',
      hi: '0.85',
      unit: 'reflectance',
      ramp: (t) => lerpStops(
        [
          [0.0, [0.08, 0.04, 0.04]],
          [0.5, [0.5, 0.32, 0.3]],
          [1.0, [1.0, 0.93, 0.86]],
        ],
        t
      ),
    },
    spectral: { regions: ['nir'] },
  },
  {
    id: 'thermal',
    key: '3',
    label: 'Thermal · canopy °C',
    note: 'Heat, like a night-vision camera. Thirsty plants can\'t sweat to cool off, so hot = water-stressed.',
    color: (health) => {
      const t = (canopyTempC(health) - 22) / 10; // 22..32 °C → 0..1
      return lerpStops(INFERNO, t);
    },
    legend: {
      lo: '22°C',
      hi: '32°C',
      unit: 'cool → hot',
      ramp: (t) => lerpStops(INFERNO, t),
    },
    // Thermal is emitted longwave IR, not reflectance — flagged for the graph.
    spectral: { emitted: 'thermal IR · 8–14 µm (emitted heat)' },
  },
  {
    id: 'ndvi',
    key: '4',
    label: 'NDVI · veg index',
    note: 'Mixes infrared and red light into a greenness score. The go-to crop-health map: green = healthy, red = struggling.',
    color: (health) => lerpStops(RDYLGN, ndvi(health) / 0.9),
    legend: { lo: '0.0', hi: '0.9', unit: 'NDVI', ramp: (t) => lerpStops(RDYLGN, t) },
    spectral: { regions: ['red', 'nir'], formula: 'NDVI = (NIR − Red) / (NIR + Red)' },
  },
  {
    id: 'ndre',
    key: '5',
    label: 'NDRE · veg index',
    note: 'Like NDVI, but sees deeper into thick, leafy plants — handy later in the season.',
    color: (health) => lerpStops(RDYLGN, (ndre(health) - 0.05) / 0.47),
    legend: { lo: '0.05', hi: '0.52', unit: 'NDRE', ramp: (t) => lerpStops(RDYLGN, t) },
    spectral: { regions: ['rededge', 'nir'], formula: 'NDRE = (NIR − RedEdge) / (NIR + RedEdge)' },
  },
  {
    id: 'sif',
    key: '6',
    label: 'SIF · fluorescence',
    note: 'A faint glow leaves give off while making food. The closest thing to watching photosynthesis from space.',
    color: (health) => lerpStops(VIRIDIS, (sif(health) - 0.1) / 1.7),
    legend: { lo: '0', hi: '2.0', unit: 'mW·m⁻²·nm⁻¹·sr⁻¹', ramp: (t) => lerpStops(VIRIDIS, t) },
    // SIF is emitted (not reflected) — narrow peaks at 685 & 740 nm.
    spectral: { emissionPeak: [685, 740] },
  },
];

export const BAND_BY_ID = Object.fromEntries(BANDS.map((b) => [b.id, b]));

/** Per-plant color for a band, from latent health (0..1). */
export function bandColor(id, health) {
  return BAND_BY_ID[id].color(health);
}

/** CSS linear-gradient string for a band's legend colorbar. */
export function legendGradient(id) {
  const ramp = BAND_BY_ID[id].legend.ramp;
  const stops = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    stops.push(`${cssRgb(ramp(t))} ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
