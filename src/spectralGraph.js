import { BAND_BY_ID, SPECTRAL_REGIONS } from './bands.js';

/**
 * Draws a leaf-reflectance spectrum (400–900 nm) and highlights the wavelength
 * region(s) the currently selected band/index samples — so the player can see
 * *which part of the spectrum* each toggle is reading.
 *
 * Thermal is handled specially: it's emitted longwave IR (~8–14 µm), not
 * reflectance, so it can't sit on this axis — we say so explicitly.
 */

// Representative reflectance curves (wavelength nm, reflectance 0..1).
const HEALTHY = [
  [400, 0.045], [470, 0.05], [550, 0.13], [620, 0.06], [670, 0.04],
  [700, 0.1], [720, 0.33], [760, 0.55], [800, 0.62], [885, 0.62], [900, 0.6],
];
const STRESSED = [
  [400, 0.06], [470, 0.07], [550, 0.14], [620, 0.12], [670, 0.2],
  [700, 0.24], [720, 0.3], [760, 0.39], [800, 0.43], [885, 0.43], [900, 0.42],
];

const WL_MIN = 400;
const WL_MAX = 900;
const R_MAX = 0.7;

export function drawSpectralGraph(canvas, bandId, logicalW = 326, logicalH = 178) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== logicalW * dpr) {
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = logicalW + 'px';
    canvas.style.height = logicalH + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, logicalW, logicalH);

  const band = BAND_BY_ID[bandId];
  const padL = 30, padR = 12, padT = 26, padB = 24;
  const plotW = logicalW - padL - padR;
  const plotH = logicalH - padT - padB;
  const x = (wl) => padL + ((wl - WL_MIN) / (WL_MAX - WL_MIN)) * plotW;
  const y = (r) => padT + (1 - r / R_MAX) * plotH;

  // Plot background.
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(padL, padT, plotW, plotH);

  // Highlighted region(s) for the active band.
  const regions = band.spectral.regions || [];
  for (const key of regions) {
    const reg = SPECTRAL_REGIONS[key];
    const x0 = x(reg.range[0]);
    const x1 = x(reg.range[1]);
    ctx.fillStyle = hexAlpha(reg.color, 0.32);
    ctx.fillRect(x0, padT, x1 - x0, plotH);
    ctx.strokeStyle = hexAlpha(reg.color, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, padT + 0.5, x1 - x0 - 1, plotH - 1);
    // region label above the band
    ctx.fillStyle = reg.color;
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(key.toUpperCase(), (x0 + x1) / 2, padT - 4);
  }

  // Axes / grid.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  ctx.fillStyle = 'rgba(232,243,224,0.5)';
  ctx.font = '8px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const wl of [400, 500, 600, 700, 800, 900]) {
    ctx.fillText(wl, x(wl), padT + plotH + 11);
  }
  ctx.save();
  ctx.translate(9, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('reflectance', 0, 0);
  ctx.restore();
  ctx.textAlign = 'right';
  ctx.fillText('nm', padL + plotW, padT + plotH + 20);

  const emitted = !!band.spectral.emitted;

  // Reflectance curves (dimmed when the active band isn't reflectance-based).
  drawCurve(ctx, STRESSED, x, y, '#d8924a', true, emitted ? 0.25 : 0.85);
  drawCurve(ctx, HEALTHY, x, y, '#8bc53f', false, emitted ? 0.3 : 1.0);

  // SIF: emission peaks riding on top of the spectrum (not reflectance).
  if (band.spectral.emissionPeak) {
    ctx.save();
    for (const wl of band.spectral.emissionPeak) {
      const px = x(wl);
      const top = y(0.66);
      const base = y(0.04);
      const grad = ctx.createLinearGradient(0, top, 0, base);
      grad.addColorStop(0, 'rgba(255,90,140,0.95)');
      grad.addColorStop(1, 'rgba(255,90,140,0.05)');
      ctx.fillStyle = grad;
      ctx.fillRect(px - 2, top, 4, base - top);
      // upward arrow head (emission)
      ctx.fillStyle = '#ff5a8c';
      ctx.beginPath();
      ctx.moveTo(px, top - 7);
      ctx.lineTo(px - 4, top + 1);
      ctx.lineTo(px + 4, top + 1);
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(wl, px, top - 10);
    }
    ctx.restore();
  }

  // Top caption: the index formula, SIF note, or the band label.
  ctx.textAlign = 'center';
  if (band.spectral.formula) {
    ctx.fillStyle = '#8bc53f';
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.fillText(band.spectral.formula, logicalW / 2, 12);
  } else if (band.spectral.emissionPeak) {
    ctx.fillStyle = '#ff5a8c';
    ctx.font = 'bold 9.5px ui-monospace, monospace';
    ctx.fillText('SIF · chlorophyll emits light it can’t use', logicalW / 2, 12);
  } else {
    ctx.fillStyle = 'rgba(232,243,224,0.8)';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillText('leaf reflectance · ' + band.label, logicalW / 2, 12);
  }

  if (emitted) {
    // Thermal can't sit on the reflectance axis — say so with a right-edge callout.
    ctx.fillStyle = 'rgba(216,146,74,0.18)';
    ctx.fillRect(padL + plotW - 2, padT, 14, plotH);
    ctx.fillStyle = '#e8a24a';
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const cx = padL + plotW / 2;
    ctx.fillText('⟶  off-chart  ⟶', cx, padT + plotH / 2 - 6);
    ctx.font = '8.5px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,176,116,0.95)';
    ctx.fillText(band.spectral.emitted, cx, padT + plotH / 2 + 8);
  }

  // Mini legend.
  ctx.textAlign = 'left';
  ctx.font = '8px ui-monospace, monospace';
  ctx.fillStyle = '#8bc53f';
  ctx.fillText('— healthy', padL + 2, padT + 10);
  ctx.fillStyle = '#d8924a';
  ctx.fillText('·· stressed', padL + 58, padT + 10);
}

function drawCurve(ctx, pts, x, y, color, dashed, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.setLineDash(dashed ? [3, 3] : []);
  ctx.beginPath();
  pts.forEach(([wl, r], i) => {
    const px = x(wl), py = y(r);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.restore();
}

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
