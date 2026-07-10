import { bandColor } from './bands.js';

/**
 * "Telescope" regional satellite view (level 3): a dense, heterogeneous 2D
 * patchwork of Central Valley fields seen through a scope vignette — thousands of
 * parcels of varying size, split from a square-mile section grid, with roads and
 * black no-data (water / urban / fallow). Switching the spectral band (1–6)
 * recolours every parcel; drag to pan across the valley.
 */
export class Telescope {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'telescope';
    Object.assign(this.canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      zIndex: '3', display: 'none', cursor: 'grab',
    });
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.bandId = 'rgb';
    this._active = false;
    this.mouse = { down: false, lx: 0, ly: 0 };
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;

    // Fields: split each ~section into a few parcels of varying size.
    this.SEC = 150;
    const secCols = 44, secRows = 34;
    this.worldW = secCols * this.SEC;
    this.worldH = secRows * this.SEC;
    this.plots = [];
    const subdivide = (x, y, w, h, depth) => {
      if (depth < 3 && w > 44 && h > 44 && Math.random() < 0.8 - depth * 0.17) {
        const splitV = w >= h ? Math.random() < 0.72 : Math.random() < 0.28;
        const r = 0.32 + Math.random() * 0.36;
        if (splitV) { subdivide(x, y, w * r, h, depth + 1); subdivide(x + w * r, y, w * (1 - r), h, depth + 1); }
        else { subdivide(x, y, w, h * r, depth + 1); subdivide(x, y + h * r, w, h * (1 - r), depth + 1); }
        return;
      }
      const cx = (x + w / 2) / this.worldW, cy = (y + h / 2) / this.worldH;
      const base = valleyHealth(cx, cy);
      // strong per-parcel variance (different crops / growth stages) over a
      // gentle regional trend → the heterogeneous CA-field look.
      const health = clamp01(base * 0.4 + Math.random() * 0.56 + 0.04);
      this.plots.push({ x, y, w, h, health, noData: noData(cx, cy) });
    };
    for (let sx = 0; sx < secCols; sx++) {
      for (let sy = 0; sy < secRows; sy++) subdivide(sx * this.SEC, sy * this.SEC, this.SEC, this.SEC, 0);
    }

    this._onMove = this._handleMove.bind(this);
    this._onDown = (e) => { this.mouse.down = true; this.mouse.lx = e.clientX; this.mouse.ly = e.clientY; this.canvas.style.cursor = 'grabbing'; };
    this._onUp = () => { this.mouse.down = false; this.canvas.style.cursor = 'grab'; };
  }

  setBand(id) { this.bandId = id; if (this._active) this._draw(); }

  setActive(on) {
    this._active = on;
    this.canvas.style.display = on ? 'block' : 'none';
    if (on) {
      this.resize();
      this.canvas.addEventListener('mousemove', this._onMove);
      this.canvas.addEventListener('mousedown', this._onDown);
      window.addEventListener('mouseup', this._onUp);
      this._draw();
    } else {
      this.canvas.removeEventListener('mousemove', this._onMove);
      this.canvas.removeEventListener('mousedown', this._onDown);
      window.removeEventListener('mouseup', this._onUp);
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._W = window.innerWidth;
    this._H = window.innerHeight;
    const minDim = Math.min(this._W, this._H);
    this.scale = (minDim * 0.11) / this.SEC; // ~7 sections across the scope
    this.panX = this._W / 2 - this.worldW * this.scale * 0.62;
    this.panY = this._H / 2 - this.worldH * this.scale * 0.58;
    this._clamp();
    if (this._active) this._draw();
  }

  update() {}
  render() {}
  get altitudeKm() { return 640; }

  _clamp() {
    this.panX = Math.min(0, Math.max(this._W - this.worldW * this.scale, this.panX));
    this.panY = Math.min(0, Math.max(this._H - this.worldH * this.scale, this.panY));
  }

  _handleMove(e) {
    if (!this.mouse.down) return;
    this.panX += e.clientX - this.mouse.lx;
    this.panY += e.clientY - this.mouse.ly;
    this.mouse.lx = e.clientX; this.mouse.ly = e.clientY;
    this._clamp();
    this._draw();
  }

  _draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.fillStyle = '#080b09'; // black no-data background
    ctx.fillRect(0, 0, this._W, this._H);

    const s = this.scale;
    for (const p of this.plots) {
      const x = p.x * s + this.panX, y = p.y * s + this.panY;
      const w = p.w * s, h = p.h * s;
      if (x + w < 0 || y + h < 0 || x > this._W || y > this._H) continue;
      if (p.noData) continue; // leave black
      const c = bandColor(this.bandId, p.health);
      ctx.fillStyle = `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`;
      ctx.fillRect(x, y, w, h);
      if (w > 3 && h > 3) {
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }

    this._drawScope(ctx);
  }

  _drawScope(ctx) {
    const cx = this._W / 2, cy = this._H / 2;
    const minDim = Math.min(this._W, this._H);
    const r = minDim * 0.44;

    const g = ctx.createRadialGradient(cx, cy, r * 0.74, cx, cy, r * 1.22);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(4,7,5,0.72)');
    g.addColorStop(1, 'rgba(2,4,3,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this._W, this._H);

    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(180,200,180,0.16)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2); ctx.stroke();

    ctx.strokeStyle = 'rgba(200,220,200,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const t = (i / 4) * r * 0.9;
      ctx.beginPath(); ctx.moveTo(cx + t, cy - 6); ctx.lineTo(cx + t, cy + 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 6, cy + t); ctx.lineTo(cx + 6, cy + t); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(210,225,210,0.6)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Central Valley · drag to pan · 1–6 change band', cx, cy + r + 26);
    ctx.textAlign = 'left';
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Gentle valley-scale trend (the dry water-stressed region + a canal-fed band);
// per-parcel randomness on top makes the field mosaic heterogeneous.
function valleyHealth(u, v) {
  let h = 0.6 + 0.2 * Math.sin(u * 6.5 + 0.3) * Math.cos(v * 5.0);
  const dx = u - 0.66, dy = v - 0.62;
  h -= 0.4 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.03)); // dry / water-stressed region
  const d = Math.abs(v - (0.4 + 0.09 * Math.sin(u * 6.0)));
  h += 0.16 * Math.exp(-(d * d) / (2 * 0.0016)); // canal-fed lush band
  return clamp01(h);
}

// Black no-data: an urban/water cluster, a reservoir, and scattered fallow.
function noData(u, v) {
  const a = (u - 0.86) ** 2 + (v - 0.2) ** 2;
  if (a < 0.006) return Math.random() < 0.85;
  const b = (u - 0.1) ** 2 + (v - 0.86) ** 2;
  if (b < 0.003) return Math.random() < 0.8;
  return Math.random() < 0.04;
}
