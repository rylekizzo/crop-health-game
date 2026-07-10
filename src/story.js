/**
 * Guided mission for the agtech learning demo (corn level).
 *
 * The arc: establish a healthy baseline on the ground, then hunt the stress down
 * the rows while a meter tracks the worst plant found, then walk back to the
 * parked drone, board it, and see the streak from the air in NDVI.
 *
 * Beats complete from real gameplay reported via sync(): leaf measurements
 * (health / maxStress), scale changes, and band selection. The mission only reads
 * game state — it never drives it. (Satellite is reached another way, added later.)
 */

const isVigorIndex = (band) => band === 'ndvi' || band === 'ndre';

const BEATS = [
  {
    eyebrow: 'Baseline · ground',
    objective: 'Take a baseline — clamp a healthy (green) leaf and press E',
    story:
      'A grower says plants in this field are struggling, but not everywhere. Before you can ' +
      'spot the problem you need to know what healthy looks like. You carry an LI-600 porometer: ' +
      'it clamps a leaf and measures how it is actually working — photosynthesis (ETR), water ' +
      'loss (gsw), and photosystem efficiency. Read a good green plant near the edge first.',
    hint: 'Move with W A S D, look with the mouse. Aim at a green plant until the crosshair turns green, then press E.',
    done: (s) => s.health != null && s.health > 0.6,
  },
  {
    eyebrow: 'Diagnose · ground',
    objective: 'Find the worst of it — measure down the rows until the stress meter fills to the mark',
    story:
      'Now hunt down the problem. The stress runs in a streak that gets worse the deeper you go ' +
      'into the field. Keep clamping leaves — the meter below tracks the most stressed plant ' +
      'you have found. Push in until it reaches the marker.',
    hint: 'The sickest rows are deep in the field, away from where you started. Keep measuring (E); the meter remembers your worst reading.',
    meter: true,
    done: (s) => s.maxStress != null && s.meterThreshold != null && s.maxStress >= s.meterThreshold,
  },
  {
    eyebrow: 'Take off',
    objective: 'Board the drone — walk back to it near your start and press Tab',
    story:
      'You have confirmed the stress leaf by leaf, but not its shape or extent — measuring every ' +
      'plant by hand would take days. Time for altitude. Your drone is parked on the ground a ' +
      'little behind and to the side of where you started. Stand next to it to board it.',
    hint: 'Head back toward your start; the drone sits just behind and off to one side. Get close and press Tab (Tab again lands it).',
    done: (s) => s.scale === 'drone',
  },
  {
    eyebrow: 'Drone · aerial',
    objective: 'Map it — switch to NDVI (press 4) and spot the streak from the air',
    story:
      'From the air you cover the whole field at once. A vegetation index like NDVI turns invisible ' +
      'stress into a map: green = vigorous, red = struggling. The rows you measured on the ground ' +
      'now show up as a single red streak — its true shape and size, which no single leaf could tell you.',
    hint: 'Press 4 for NDVI. Fly out over the field (W A S D, Space / C for altitude) and find the red streak.',
    done: (s) => s.scale === 'drone' && isVigorIndex(s.band),
  },
];

const FINALE = {
  eyebrow: 'Nice work',
  objective: 'Ground truth, meet the big picture 🎉',
  story:
    'You diagnosed the streak leaf by leaf, then rose up to see its whole shape from the air — the ' +
    'porometer is accurate but short-reach, the drone maps the field in seconds. Keep exploring: ' +
    'fly the field in other bands (Thermal 3, NDRE 5), or land (Tab) and measure more rows.',
  hint: null,
};

const AUTO_HINT_MS = 30000; // reveal the hint automatically if a beat stalls this long

export class Mission {
  constructor() {
    this.el = document.getElementById('mission');
    this.elEyebrow = document.getElementById('m-eyebrow');
    this.elStep = document.getElementById('m-step');
    this.elObj = document.getElementById('m-obj');
    this.elStory = document.getElementById('m-story');
    this.elDots = document.getElementById('m-dots');
    this.elHint = document.getElementById('m-hint');
    this.elMeter = document.getElementById('m-meter');
    this.elMeterFill = document.getElementById('m-meter-fill');
    this.elMeterThresh = document.getElementById('m-meter-thresh');
    this.elMeterLabel = document.getElementById('m-meter-label');

    this.i = 0;
    this.started = false;
    this.hintShown = false;
    this.state = { scale: 'proximal', band: 'rgb', measured: false, health: null, maxStress: 0 };
    this._hintTimer = null;
  }

  start() {
    this.started = true;
    this.i = 0;
    this._render();
  }

  /** Merge in the latest game state and advance through any completed beats. */
  sync(patch) {
    Object.assign(this.state, patch);
    if (!this.started) return;
    let advanced = false;
    while (this.i < BEATS.length && BEATS[this.i].done(this.state)) {
      this.i++;
      advanced = true;
    }
    if (advanced) {
      this.hintShown = false;
      this._render(true);
    } else if (this._current().meter) {
      this._renderMeter(); // keep the stress meter live between advances
    }
  }

  toggleHint() {
    const beat = this._current();
    if (!beat || !beat.hint) return;
    this.hintShown = !this.hintShown;
    this._renderHint();
  }

  _current() {
    return this.i < BEATS.length ? BEATS[this.i] : FINALE;
  }

  _render(justAdvanced = false) {
    const beat = this._current();
    const complete = this.i >= BEATS.length;

    this.elEyebrow.textContent = beat.eyebrow;
    this.elStep.textContent = complete ? '✓ done' : `Step ${this.i + 1} of ${BEATS.length}`;
    this.elObj.textContent = beat.objective;
    this.elStory.textContent = beat.story;

    this.elDots.innerHTML = BEATS.map((_, k) => {
      const cls = k < this.i ? 'done' : k === this.i ? 'active' : '';
      return `<span class="m-dot ${cls}"></span>`;
    }).join('');

    this.el.classList.toggle('complete', complete);
    if (justAdvanced) {
      this.el.classList.remove('flash');
      void this.el.offsetWidth; // restart the flash animation
      this.el.classList.add('flash');
    }

    this._renderHint();
    this._renderMeter();

    clearTimeout(this._hintTimer);
    if (!complete && beat.hint) {
      this._hintTimer = setTimeout(() => {
        this.hintShown = true;
        this._renderHint();
      }, AUTO_HINT_MS);
    }
  }

  _renderMeter() {
    if (!this.elMeter) return;
    const beat = this._current();
    if (!beat.meter) {
      this.elMeter.style.display = 'none';
      return;
    }
    const max = this.state.meterMax || 1;
    const fill = Math.min(1, (this.state.maxStress || 0) / max);
    const mark = Math.min(1, (this.state.meterThreshold || max) / max);
    this.elMeter.style.display = 'block';
    this.elMeterFill.style.width = (fill * 100).toFixed(0) + '%';
    this.elMeterFill.style.background = `hsl(${Math.round((1 - fill) * 110)}, 72%, 46%)`; // green → red with stress
    this.elMeterThresh.style.left = (mark * 100).toFixed(0) + '%';
    const pct = Math.round((this.state.maxStress || 0) * 100);
    const done = (this.state.maxStress || 0) >= (this.state.meterThreshold || 1);
    this.elMeterLabel.textContent = done
      ? `Worst found: ${pct}% stress — target reached ✓`
      : `Worst found: ${pct}% stress — reach the marker`;
  }

  _renderHint() {
    const beat = this._current();
    if (!beat.hint) {
      this.elHint.innerHTML = '';
      return;
    }
    this.elHint.innerHTML = this.hintShown
      ? `<span class="m-hint-icon">💡</span> ${beat.hint} <span class="m-hint-key">(H to hide)</span>`
      : `<span class="m-hint-key">Stuck? Press <kbd>H</kbd> for a hint</span>`;
  }
}
