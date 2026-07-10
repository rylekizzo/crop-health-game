/**
 * Approximate peak growing-season (summer) average NDVI by U.S. state.
 *
 * These are representative, education-grade values consistent with published
 * MODIS/Landsat growing-season NDVI: humid cropland and forest in the Corn Belt,
 * Southeast, and Northeast run high (~0.8); the arid Intermountain West and desert
 * Southwest run low (Nevada is the barest at ~0.15). They are static so the
 * satellite view is fully offline and robust — no live imagery to break.
 *
 * NDVI ranges ~0 (bare soil/rock) to ~0.9 (dense green canopy).
 */
export const STATE_NDVI = {
  Alabama: 0.80,
  Arizona: 0.22,
  Arkansas: 0.82,
  California: 0.45,
  Colorado: 0.38,
  Connecticut: 0.78,
  Delaware: 0.76,
  'District of Columbia': 0.70,
  Florida: 0.72,
  Georgia: 0.80,
  Idaho: 0.42,
  Illinois: 0.83,
  Indiana: 0.82,
  Iowa: 0.86, // Corn Belt peak — the greenest state in midsummer
  Kansas: 0.58,
  Kentucky: 0.80,
  Louisiana: 0.78,
  Maine: 0.81,
  Maryland: 0.76,
  Massachusetts: 0.75,
  Michigan: 0.76,
  Minnesota: 0.72,
  Mississippi: 0.83,
  Missouri: 0.78,
  Montana: 0.40,
  Nebraska: 0.60,
  Nevada: 0.15, // Great Basin desert — the barest state
  'New Hampshire': 0.80,
  'New Jersey': 0.74,
  'New Mexico': 0.28,
  'New York': 0.78,
  'North Carolina': 0.79,
  'North Dakota': 0.58,
  Ohio: 0.81,
  Oklahoma: 0.60,
  Oregon: 0.55,
  Pennsylvania: 0.79,
  'Rhode Island': 0.73,
  'South Carolina': 0.79,
  'South Dakota': 0.55,
  Tennessee: 0.80,
  Texas: 0.48,
  Utah: 0.26,
  Vermont: 0.82,
  Virginia: 0.78,
  Washington: 0.55,
  'West Virginia': 0.82,
  Wisconsin: 0.77,
  Wyoming: 0.36,
};

// States not on the contiguous map (or without data) are skipped by the view.
export const NON_CONUS = new Set(['Alaska', 'Hawaii', 'Puerto Rico']);

/** NDVI (~0.1–0.9) → a 0–1 vigor value for the shared band color ramps. */
export function ndviToHealth(ndvi) {
  return Math.max(0, Math.min(1, (ndvi - 0.1) / 0.78));
}

/** The states with the highest and lowest average NDVI (the objective's answer). */
export function ndviExtremes() {
  let max = null, min = null;
  for (const [name, v] of Object.entries(STATE_NDVI)) {
    if (!max || v > max.ndvi) max = { name, ndvi: v };
    if (!min || v < min.ndvi) min = { name, ndvi: v };
  }
  return { max, min };
}
