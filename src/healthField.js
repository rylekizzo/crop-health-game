/**
 * Ground-truth crop physiology as a continuous spatial field.
 *
 * This is the single source of truth that every measurement scale samples:
 *   - proximal (LI-600): reads one plant directly, with instrument noise
 *   - drone / satellite (later): sample the same field at coarser resolution
 *
 * `health` is a 0..1 latent vigor scalar. Real instrument quantities (stomatal
 * conductance, ΦPSII, ETR) are derived from it so the teaching story stays
 * consistent across scales.
 */

const PAR_AMBIENT = 1600; // incident PAR on a sunny field, µmol m⁻² s⁻¹ (PARi)

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Cheap smooth, deterministic 2D variation (no texture needed).
function smoothNoise(x, z) {
  return (
    Math.sin(x * 0.18) * Math.cos(z * 0.16) * 0.5 +
    Math.sin(x * 0.05 + 1.7) * Math.sin(z * 0.07 + 0.4) * 0.5
  );
}

/**
 * Latent health at a world position, 0 (severely stressed) .. 1 (vigorous).
 *
 * Corn has its own pattern (see cornHealth); every other crop keeps the original
 * field: a circular drought/heat patch plus a nutrient-deficient strip.
 */
export function fieldHealth(x, z, cropId) {
  if (cropId === 'corn') return cornHealth(x, z);

  let h = 0.82 + 0.1 * smoothNoise(x, z);

  // Drought patch centered at (18, -12).
  const dx = x - 18;
  const dz = z + 12;
  h -= 0.65 * Math.exp(-(dx * dx + dz * dz) / (2 * 13 * 13));

  // Nutrient-deficient strip along x ≈ -22.
  h -= 0.3 * Math.exp(-((x + 22) * (x + 22)) / (2 * 6.0 * 6.0));

  return clamp(h, 0.05, 1);
}

/**
 * Corn: a mostly-vigorous field with a single realistic problem — a narrow streak
 * only a few rows wide (rows run along Z), like a drainage/compaction line. The
 * stress is a gradient: worst near mid-field and easing toward the ends, plus
 * fine mottling so the strip isn't a clean band.
 */
function cornHealth(x, z) {
  let h = 0.86 + 0.08 * smoothNoise(x, z); // mostly healthy, gentle variation

  const across = Math.exp(-((x + 5) * (x + 5)) / (2 * 1.1 * 1.1));  // a couple of rows wide, at x ≈ -5
  const along = Math.exp(-((z + 14) * (z + 14)) / (2 * 15 * 15));   // gradient down the strip; worst deep in the field (z ≈ -14), away from the entrance
  const mottle = 0.72 + 0.28 * smoothNoise(x * 2.6, z * 1.3);       // patchiness within the strip
  // Deep enough that the core bottoms out (health ~0.05–0.14) → solid red in NDVI,
  // while the width and ends still gradient out through orange to green.
  h -= 1.0 * across * along * mottle;

  return clamp(h, 0.05, 1);
}

/**
 * True (noise-free) physiology for a given health value. These are the values
 * the plant "actually" has; instruments observe noisy versions of them.
 */
export function truePhysiology(health) {
  const gsw = 0.03 + 0.5 * health; // stomatal conductance, mol m⁻² s⁻¹
  const phiPSII = 0.05 + 0.45 * health; // operating efficiency of PSII
  const etr = phiPSII * PAR_AMBIENT * 0.84 * 0.5; // electron transport rate, µmol m⁻² s⁻¹
  const fvfmPrime = 0.45 + 0.35 * health; // light-adapted max efficiency
  return { gsw, phiPSII, etr, fvfmPrime, parI: PAR_AMBIENT, health };
}

// --- Aerial-sensor proxies (drone scale) -----------------------------------
// The same latent health drives what a multispectral/thermal drone sensor sees.

const AIR_TEMP_C = 32; // ambient air temperature on a sunny day

/** Red canopy reflectance (~660 nm). Chlorophyll absorbs red, so healthy = LOW. */
export function redReflectance(health) {
  return 0.25 - 0.21 * health; // ~0.25 (stressed) .. ~0.04 (healthy)
}

/** Red-edge reflectance (~720 nm). Sits on the chlorophyll transition shoulder. */
export function redEdgeReflectance(health) {
  return 0.18 + 0.1 * health; // ~0.18 (stressed) .. ~0.28 (healthy)
}

/** Near-infrared canopy reflectance (~800 nm). Vigorous canopy reflects more NIR. */
export function nirReflectance(health) {
  return 0.18 + 0.67 * health; // ~0.18 (bare/stressed) .. ~0.85 (dense, healthy)
}

/** NDVI = (NIR − Red)/(NIR + Red). Greenness/biomass; saturates in dense canopy. */
export function ndvi(health) {
  const nir = nirReflectance(health);
  const red = redReflectance(health);
  return (nir - red) / (nir + red);
}

/** NDRE = (NIR − RedEdge)/(NIR + RedEdge). Sees deeper into dense canopy than NDVI. */
export function ndre(health) {
  const nir = nirReflectance(health);
  const re = redEdgeReflectance(health);
  return (nir - re) / (nir + re);
}

/**
 * Solar-induced chlorophyll fluorescence (mW m⁻² nm⁻¹ sr⁻¹, far-red ~740 nm).
 * SIF is light re-emitted by chlorophyll during photosynthesis — the most
 * direct remotely-sensed proxy for actual photosynthetic activity (GPP). It is
 * the satellite-scale analog of the LI-600's ΦPSII/ETR fluorescence reading.
 */
export function sif(health) {
  return 0.1 + 1.7 * health; // ~0.1 (no photosynthesis) .. ~1.8 (vigorous)
}

/**
 * Regional latent health over a landscape tile (u, v ∈ 0..1), for the coarse
 * satellite raster. A patchwork of fields with a low-vigor river and a drought
 * region — structure that survives even at coarse resolution.
 */
export function regionalHealth(u, v) {
  let h = 0.62 + 0.22 * Math.sin(u * 6.5 + 0.4) * Math.cos(v * 5.5);
  h += 0.12 * Math.sin(u * 14.0) * Math.sin(v * 12.0);
  // river / water: a low-vigor diagonal band
  const d = Math.abs(u - v - 0.04);
  h -= 0.55 * Math.exp(-(d * d) / (2 * 0.022 * 0.022));
  // regional drought
  const dx = u - 0.72, dy = v - 0.34;
  h -= 0.45 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.05 * 0.05));
  return clamp(h, 0.05, 1);
}

/**
 * Canopy temperature (°C). Well-watered plants transpire and cool below air
 * temperature; water-stressed plants close stomata and run hot. This is the
 * inverse of stomatal conductance — the core idea thermal imaging teaches.
 */
export function canopyTempC(health) {
  return AIR_TEMP_C - 10 * health; // ~32°C (stressed) .. ~22°C (healthy)
}

/**
 * Apply realistic instrument noise to the true physiology to produce one
 * measurement. `rng` is a 0..1 source so callers control determinism.
 */
export function measurePhysiology(truth, rng = Math.random) {
  const jitter = (frac) => 1 + (rng() - 0.5) * 2 * frac;
  const gsw = Math.max(0, truth.gsw * jitter(0.05));
  const phiPSII = clamp(truth.phiPSII + (rng() - 0.5) * 0.02, 0, 0.83);
  const etr = phiPSII * truth.parI * 0.84 * 0.5;
  const fvfmPrime = clamp(truth.fvfmPrime + (rng() - 0.5) * 0.01, 0, 0.83);
  return { gsw, phiPSII, etr, fvfmPrime, parI: truth.parI, health: truth.health };
}
