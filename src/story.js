/**
 * Guided mission for the agtech learning demo.
 *
 * A crop-scout storyline that goes fine → coarse: the student first diagnoses a
 * sick plant up close with the LI-600 porometer (accurate, but one leaf at a
 * time), then discovers they can't hand-measure a whole field and unlocks the
 * drone and satellite for reach — learning that scale matters, and that each
 * scale trades accuracy for coverage.
 *
 * Each beat carries narrative + an objective + a hint, and completes from actual
 * gameplay (scale changes, band selection, leaf measurements) reported via sync().
 * The mission is purely presentational — it never drives the game, only reads it.
 */

const isVigorIndex = (band) => band === 'ndvi' || band === 'ndre';

const BEATS = [
  {
    eyebrow: 'Proximal · ground',
    objective: 'Take your first reading — aim at a plant and press E',
    story:
      'A grower says plants in this field are struggling — but not everywhere, and they ' +
      'can’t say why. You’re standing in the field with an LI-600 porometer: it clamps a ' +
      'single leaf and measures how it is actually working — photosynthesis (ETR), water ' +
      'loss through the stomata (gsw), and photosystem efficiency (ΦPSII, Fv′/Fm′).',
    hint: 'Move with W A S D, look with the mouse. Aim at a plant until the crosshair turns green, then press E. The reading appears on the right.',
    done: (s) => s.measured === true,
  },
  {
    eyebrow: 'Diagnosis · ground',
    objective: 'Find a struggling plant — measure a leaf that reads “Stressed”',
    story:
      'That reading is ground truth: nothing is more accurate than clamping the actual ' +
      'leaf. Now find the problem. A stressed leaf shows low ETR and gsw — it is ' +
      'photosynthesizing and transpiring less. Hunt down a plant that is clearly in trouble.',
    hint: 'Stressed plants look paler and yellower even in true color. Keep clamping leaves (E) until the panel tags one “Stressed”.',
    done: (s) => s.health != null && s.health < 0.45,
  },
  {
    eyebrow: 'Reach · the catch',
    objective: 'See the bigger picture — press Tab to lift off in the drone',
    story:
      'You’ve confirmed one sick plant, precisely. But is it one plant, a patch, or the ' +
      'whole field? Hand-measuring every plant would take days — the porometer is accurate ' +
      'but slow and short-reach. To see how far the problem spreads, you need altitude.',
    hint: 'Tab cycles the scales: ground → drone → satellite. Press Tab once to lift off in the drone.',
    done: (s) => s.scale === 'drone',
  },
  {
    eyebrow: 'Drone · aerial',
    objective: 'Map the stress — switch to NDVI (press 4) and find the affected zone',
    story:
      'From the air you cover the whole field in seconds. A vegetation index like NDVI ' +
      'mixes red and near-infrared light to turn invisible stress into a map: green = ' +
      'vigorous, yellow/red = struggling. Now you can see the shape and size of the ' +
      'problem — something no single leaf could tell you. You trade a little per-leaf ' +
      'accuracy for enormous reach.',
    hint: 'Press 4 for NDVI. Fly with W A S D and Space / C for altitude, and look for the yellow/red patch.',
    done: (s) => s.scale === 'drone' && isVigorIndex(s.band),
  },
  {
    eyebrow: 'Satellite · orbital',
    objective: 'Zoom out to orbit — press Tab to the satellite, then NDVI (press 4)',
    story:
      'Go higher still. From orbit one satellite watches whole regions — your entire field is ' +
      'smaller than a single pixel. You lose the plant, but you gain the country: the map now ' +
      'shows every state shaded by its average growing-season NDVI.',
    hint: 'Press Tab until the U.S. map appears, then press 4 for NDVI.',
    done: (s) => s.scale === 'satellite' && s.band === 'ndvi',
  },
  {
    eyebrow: 'CONUS · NDVI',
    objective: 'Read the map — find the single highest- and lowest-NDVI states',
    story:
      'At orbital scale you compare whole states, not plants — over the real satellite NDVI. ' +
      'Hover states to read their average NDVI, and work out which one state is the greenest ' +
      'and which is the barest. Drag to orbit, scroll to zoom.',
    hint: null,
    done: (s) => s.satExtremes === true,
  },
];

const FINALE = {
  eyebrow: 'Mission complete',
  objective: 'You climbed the scales 🎉',
  story:
    'You diagnosed the problem leaf by leaf, then climbed until whole states fit on screen. ' +
    'That is the tradeoff at the heart of precision agriculture: the porometer is accurate ' +
    'but short-reach, the drone maps a field, the satellite compares whole regions. No single ' +
    'scale is enough; each answers a different question. Keep exploring: switch crops (F), ' +
    'try Thermal (3) or SIF (6).',
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

    this.i = 0;
    this.started = false;
    this.hintShown = false;
    this.state = { scale: 'proximal', band: 'rgb', measured: false, health: null };
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

    clearTimeout(this._hintTimer);
    if (!complete && beat.hint) {
      this._hintTimer = setTimeout(() => {
        this.hintShown = true;
        this._renderHint();
      }, AUTO_HINT_MS);
    }
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
