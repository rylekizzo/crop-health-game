import { bandColor } from './bands.js';

/**
 * "Telescope" regional satellite view (level 3): a 2D patchwork of Central Valley
 * almond blocks seen through a scope vignette. Distinct from the 3D globe — this
 * is about scanning thousands of acres of *other* plots at once. Switching the
 * spectral band (1–6) recolours every block so you can spot the water-stressed
 * ones across the whole valley; drag to pan the scope around.
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

    // Virtual valley of orchard blocks.
    this.BLOCK = 110; // world px per block (incl. road)
    this.PLOT = 94;
    this.cols = 46;
    this.rows = 36;
    this.worldW = this.cols * this.BLOCK;
    this.worldH = this.rows * this.BLOCK;
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;

    this.plots = [];
    for (let cx = 0; cx < this.cols; cx++) {
      for (let cy = 0; cy < this.rows; cy++) {
        const u = cx / this.cols, v = cy / this.rows;
        const rot = ((cx + cy) % 3 === 0); // some blocks planted the other way (rows run east-west)
        this.plots.push({
          x: cx * this.BLOCK, y: cy * this.BLOCK,
          health: valleyHealth(u, v) + (Math.random() - 0.5) * 0.06,
          rows: rot,
        });
      }
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
    this.scale = (minDim * 0.08) / this.BLOCK; // ~10 blocks across the scope
    // start centred on the valley, biased toward the dry region
    this.panX = this._W / 2 - this.worldW * this.scale * 0.62;
    this.panY = this._H / 2 - this.worldH * this.scale * 0.6;
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
    ctx.fillStyle = '#7c6a48'; // valley soil between blocks
    ctx.fillRect(0, 0, this._W, this._H);

    const s = this.scale, ps = this.PLOT * s;
    const col = bandColor('rgb', 0).constructor ? new (bandColor('rgb', 0).constructor)() : null;
    for (const p of this.plots) {
      const x = p.x * s + this.panX;
      const y = p.y * s + this.panY;
      if (x + ps < 0 || y + ps < 0 || x > this._W || y > this._H) continue; // cull
      const c = bandColor(this.bandId, Math.max(0, Math.min(1, p.health)));
      ctx.fillStyle = `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`;
      ctx.fillRect(x, y, ps, ps);
      // faint row texture
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const n = 5;
      for (let i = 1; i < n; i++) {
        if (p.rows) { const yy = y + (ps * i) / n; ctx.moveTo(x, yy); ctx.lineTo(x + ps, yy); }
        else { const xx = x + (ps * i) / n; ctx.moveTo(xx, y); ctx.lineTo(xx, y + ps); }
      }
      ctx.stroke();
    }

    this._drawScope(ctx);
  }

  _drawScope(ctx) {
    const cx = this._W / 2, cy = this._H / 2;
    const minDim = Math.min(this._W, this._H);
    const r = minDim * 0.42;

    // vignette: clear circle in the middle, dark to opaque at the edges
    const g = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r * 1.25);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, 'rgba(6,10,8,0.72)');
    g.addColorStop(1, 'rgba(3,6,4,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this._W, this._H);

    // scope ring
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(180,200,180,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2); ctx.stroke();

    // reticle
    ctx.strokeStyle = 'rgba(200,220,200,0.22)';
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
    ctx.fillText('Central Valley almond plots · drag to pan · 1–6 change band', cx, cy + r + 26);
    ctx.textAlign = 'left';
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Valley-scale health: mostly vigorous, with a dry (water-stressed) region and a
// lush canal band. u,v ∈ 0..1 across the valley.
function valleyHealth(u, v) {
  let h = 0.72 + 0.15 * Math.sin(u * 7.5 + 0.3) * Math.cos(v * 5.5);
  h += 0.1 * Math.sin(u * 17) * Math.sin(v * 13);
  const dx = u - 0.66, dy = v - 0.62;
  h -= 0.5 * Math.exp(-(dx * dx + dy * dy) / (2 * 0.02)); // dry / water-stressed
  const d = Math.abs(v - (0.38 + 0.08 * Math.sin(u * 6.5)));
  h += 0.14 * Math.exp(-(d * d) / (2 * 0.0013)); // canal-fed lush band
  return clamp01(h);
}
