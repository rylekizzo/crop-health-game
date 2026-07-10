/**
 * Guided, multi-level mission for the agtech learning demo.
 *
 * Each level (corn, strawberry) has its own beats and a completion dialogue.
 * When a level's beats are all done, a dialogue box explains the diagnosis and
 * (for corn) sends the player to the next level. Beats complete from real
 * gameplay reported via sync(); the mission only reads state, never drives it.
 */

const isVigorIndex = (band) => band === 'ndvi' || band === 'ndre';

// --- Level 1: corn — nitrogen deficiency ----------------------------------
const CORN_BEATS = [
  {
    eyebrow: 'Baseline · ground',
    objective: 'Take a baseline — clamp a healthy (green) leaf and press E',
    story:
      'A grower says plants in this field are struggling, but not everywhere. Before you can ' +
      'spot the problem you need to know what healthy looks like. Your LI-600 porometer clamps a ' +
      'leaf and measures how it is working — photosynthesis (ETR), water loss (gsw), and ' +
      'photosystem efficiency. Read a good green plant near the edge first.',
    hint: 'Move with W A S D, look with the mouse. Aim at a green plant until the crosshair turns green, then press E.',
    done: (s) => s.health != null && s.health > 0.6,
  },
  {
    eyebrow: 'Diagnose · ground',
    objective: 'Find the worst of it — measure down the rows until the stress meter fills to the mark',
    story:
      'Now hunt the problem down. A pale streak runs into the field, worse the deeper you go. ' +
      'Keep clamping leaves — the meter below tracks the most stressed plant you have found. ' +
      'Push in until it reaches the marker.',
    hint: 'The sickest rows are deep in the field, away from where you started. Keep measuring (E); the meter remembers your worst reading.',
    meter: 'stress',
    done: (s) => s.maxStress != null && s.meterThreshold != null && s.maxStress >= s.meterThreshold,
  },
  {
    eyebrow: 'Take off',
    objective: 'Board the drone — walk back to it near your start and press Tab',
    story:
      'You have confirmed the stress leaf by leaf, but not its shape. Time for altitude. Your drone ' +
      'is parked on the ground a little behind and to the side of where you started. Stand next to ' +
      'it to board it.',
    hint: 'Head back toward your start; the drone sits just behind and off to one side. Get close and press Tab (Tab again lands it).',
    done: (s) => s.scale === 'drone',
  },
  {
    eyebrow: 'Drone · aerial',
    objective: 'Map it — switch to NDVI (press 4) and spot the streak from the air',
    story:
      'From the air you cover the whole field at once. NDVI turns invisible stress into a map: ' +
      'green = vigorous, red = struggling. The rows you measured now show up as a single red streak — ' +
      'its true shape, which no single leaf could tell you.',
    hint: 'Press 4 for NDVI. Fly out over the field and find the red streak.',
    done: (s) => s.scale === 'drone' && isVigorIndex(s.band),
  },
];

const CORN_COMPLETE = {
  title: 'It was the nitrogen',
  body:
    "That pale streak is textbook nitrogen deficiency — a single line of chlorotic, low-vigor rows. " +
    "The cause wasn't drought or disease: the rig that side-dressed nitrogen fertilizer malfunctioned " +
    "along this one pass, starving those rows while the rest of the field got its full dose. Ground " +
    "truth plus the aerial map pinned it down.\n\n" +
    "Next up: a strawberry field with a very different kind of trouble.",
  button: 'Go to the strawberry field →',
  next: 'strawberry',
};

// --- Level 2: strawberry — aphid infestation ------------------------------
const BERRY_BEATS = [
  {
    eyebrow: 'Scout · ground',
    objective: 'Inspect an infested plant — aim at one crawling with aphids and press I',
    story:
      "This grower's strawberries are wilting in patches. Yellow sticky traps are staked through the " +
      "field to catch pests — near the sick plants they're black with tiny insects, and you can see " +
      "them swarming the leaves. Aim at a badly infested plant and press I to identify the culprit.",
    hint: 'Walk toward the plants covered in bugs (the sticky traps there are dark with them). Aim at one until the crosshair turns green and press I.',
    done: (s) => s.inspectedPest === true,
  },
  {
    eyebrow: 'Take off',
    objective: 'Board the drone — walk to it and press Tab to treat from the air',
    story:
      'Aphids: soft-bodied sap-suckers that breed explosively and spread fast. Spraying by hand ' +
      'would take forever and miss spots. Take the drone up to treat the whole infested patch at once.',
    hint: 'The drone is parked near where you started, a little behind and to the side. Stand next to it and press Tab.',
    done: (s) => s.scale === 'drone',
  },
  {
    eyebrow: 'Drone · release',
    objective: 'Cover the infestation — fly over the sick plants and hold Click to release',
    story:
      'Fly low over the infested patch and hold the mouse button to release your treatment. Sweep ' +
      'back and forth until every infested plant is covered — the bar tracks your progress.',
    hint: 'Descend with C to get low over the red/wilting patch, then hold the left mouse button and fly across it. Keep going until the bar is full.',
    meter: 'coverage',
    done: (s) => (s.coverage || 0) >= 0.999,
  },
];

const BERRY_COMPLETE = {
  title: 'Organic pest control: ladybugs',
  body:
    "Those plants were under attack by aphids. On a conventional farm you might reach for an " +
    "insecticide — but these are certified organic strawberries, so synthetic pesticides are off " +
    "the table. What you released instead were ladybugs: a single one eats dozens of aphids a day, " +
    "and they're a classic biological control. They'll knock the infestation down and keep it in " +
    "check — no chemicals required.",
  button: 'On to the almond orchard →',
  next: 'almond',
};

// --- Level 3: almond — water stress + regional satellite --------------------
const ALMOND_BEATS = [
  {
    eyebrow: 'Orchard · ground',
    objective: 'Board the drone — walk to it and press Tab',
    story:
      'This almond grower has a block of trees looking off, but from the ground the orchard seems ' +
      'fine. Almonds are thirsty and this is the dry season — get airborne to look for trouble.',
    hint: 'The drone is parked near where you started, a little behind and to the side. Stand next to it and press Tab.',
    done: (s) => s.scale === 'drone',
  },
  {
    eyebrow: 'Drone · thermal',
    objective: 'Find the trouble — switch to Thermal (press 3) and spot the hot block',
    story:
      'Water-stressed trees close their stomata to save moisture — so they stop transpiring and ' +
      'run hot. A thermal camera makes that visible: a well-watered canopy is cool, a thirsty one ' +
      'glows. Find the warm block.',
    hint: 'Press 3 for Thermal and fly over the orchard. The water-stressed block shows up hot (bright).',
    done: (s) => s.scale === 'drone' && s.band === 'thermal',
  },
  {
    eyebrow: 'Scale up',
    objective: "The grower asks about their other 5,000 acres — press V for satellite imagery",
    story:
      "You've pinned the problem in this orchard. Now the grower asks: can you check all 5,000 acres " +
      'of their other plots the same way? A drone can\'t — that would take weeks. This is what ' +
      'satellite imagery is for: whole regions at once.',
    hint: 'Press V to pull up the satellite view of the valley.',
    done: (s) => s.scale === 'regional',
  },
  {
    eyebrow: 'Satellite · valley',
    objective: 'Report the worst blocks — switch to NDVI (4) and click 5 low-NDVI plots',
    story:
      'Every rectangle is an almond block, hundreds of acres each. Switch to NDVI to read them all ' +
      'at once — the low-vigor, water-short blocks glow red against the healthy green. Click the five ' +
      'worst ones to flag them for the grower to send a crew to first.',
    hint: 'Press 4 for NDVI, drag to pan. Click the reddest (lowest-NDVI) blocks — each click flags one. Find five.',
    meter: 'count',
    done: (s) => (s.flaggedLow || 0) >= 5,
  },
];

const ALMOND_COMPLETE = {
  title: 'A water problem, at every scale',
  body:
    'The hot block was water stress — a failed lateral line left those trees without irrigation, so ' +
    'they closed their stomata, stopped cooling themselves, and ran hot (exactly what thermal sees). ' +
    'On the ground it looked fine; only the aerial and orbital views revealed it.\n\n' +
    'And across 5,000 acres, satellite imagery is the only practical way to flag which blocks to send ' +
    'a crew or a drone to next. One last job: zoom all the way out.',
  button: 'Go to orbit →',
  next: 'usa',
};

// --- Level 4: national — read NDVI across the whole country -----------------
const USA_BEATS = [
  {
    eyebrow: 'Orbit · national',
    objective: 'Read the map — drag to orbit, hover states to see their average NDVI',
    story:
      'From orbit a single field is a speck. What a satellite gives you instead is the whole country ' +
      'at once: this is real MODIS growing-season NDVI, and every state has an average value. Green = ' +
      'lush cropland and forest; brown = bare desert and range. Hover states to read them.',
    hint: 'Drag to spin the globe and scroll to zoom. Hover any state to see its name and average NDVI.',
    done: (s) => s.satHovered === true,
  },
  {
    eyebrow: 'USDA task',
    objective: 'Name the extremes — enter the highest- and lowest-NDVI states, then Submit',
    story:
      'The USDA wants the single greenest and single barest state by average growing-season NDVI. ' +
      'Sweep the map, compare the values, and file your report in the box below. Get both right to ' +
      'close out the survey.',
    hint: 'The greenest states are humid Corn Belt cropland; the lowest are arid Great Basin / desert. Fill in both boxes and press Submit.',
    done: (s) => s.satQuiz === true,
  },
];

const USA_COMPLETE = {
  title: 'Right tool, right scale',
  body:
    "Iowa's Corn Belt is the greenest state at peak season; Nevada's Great Basin desert is the barest. " +
    'From a leaf clamp reading one plant, to a drone mapping one field, to a satellite ranking every ' +
    'state — each scale answered a question none of the others could. Matching the instrument to the ' +
    'question is the whole job.\n\n' +
    'That completes the survey. The country is yours now — roam any field freely.',
  button: 'Free roam',
  next: null,
};

const LEVELS = {
  corn: { beats: CORN_BEATS, complete: CORN_COMPLETE },
  strawberry: { beats: BERRY_BEATS, complete: BERRY_COMPLETE },
  almond: { beats: ALMOND_BEATS, complete: ALMOND_COMPLETE },
  usa: { beats: USA_BEATS, complete: USA_COMPLETE },
};

const AUTO_HINT_MS = 30000;

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

    // Completion dialogue modal.
    this.dlg = document.getElementById('dialogue');
    this.dlgTitle = document.getElementById('d-title');
    this.dlgBody = document.getElementById('d-body');
    this.dlgBtn = document.getElementById('d-button');
    if (this.dlgBtn) this.dlgBtn.addEventListener('click', () => this.proceed());
    this.awaiting = false; // a completion box is up, waiting for Enter

    this.levelId = 'corn';
    this.beats = CORN_BEATS;
    this.complete = CORN_COMPLETE;
    this.i = 0;
    this.started = false;
    this.finished = false;
    this.hintShown = false;
    this.state = { scale: 'proximal', band: 'rgb' };
    this._hintTimer = null;

    this.onLevelComplete = null; // (nextLevelId|null) => void — set by main.js
  }

  /** Begin (or restart) a level's mission. */
  startLevel(id) {
    const lvl = LEVELS[id] || LEVELS.corn;
    this.levelId = id;
    this.beats = lvl.beats;
    this.complete = lvl.complete;
    this.i = 0;
    this.started = true;
    this.finished = false;
    this.hintShown = false;
    this._hideDialogue();
    this.el.classList.add('show');
    this._render();
  }

  /** Game finished: turn the panel into a persistent free-roam legend. */
  freeRoam() {
    this.started = false;
    this.finished = true;
    clearTimeout(this._hintTimer);
    this._hideDialogue();
    this.awaiting = false;
    if (this.elMeter) this.elMeter.style.display = 'none';
    this.elEyebrow.textContent = 'Free roam';
    this.elStep.textContent = '✓ survey complete';
    this.elObj.textContent = 'Explore any field, at any scale';
    this.elStory.textContent =
      'The campaign is done. Roam wherever you like and try every instrument.';
    this.elDots.innerHTML = '';
    this.elHint.innerHTML =
      '<span class="m-hint-key"><kbd>F</kbd> change field &nbsp;·&nbsp; <kbd>Tab</kbd> board the drone anywhere &nbsp;·&nbsp; <kbd>V</kbd> regional satellite &nbsp;·&nbsp; <kbd>1–6</kbd> bands</span>';
    this.el.classList.remove('complete');
    this.el.classList.add('show');
  }

  sync(patch) {
    Object.assign(this.state, patch);
    if (!this.started || this.finished) return;
    let advanced = false;
    while (this.i < this.beats.length && this.beats[this.i].done(this.state)) {
      this.i++;
      advanced = true;
    }
    if (this.i >= this.beats.length) {
      this.finished = true;
      this._render(true);
      this._showDialogue();
      return;
    }
    if (advanced) {
      this.hintShown = false;
      this._render(true);
    } else if (this._current().meter) {
      this._renderMeter();
    }
  }

  toggleHint() {
    const beat = this._current();
    if (!beat || !beat.hint) return;
    this.hintShown = !this.hintShown;
    this._renderHint();
  }

  _current() {
    return this.i < this.beats.length ? this.beats[this.i] : null;
  }

  _render(justAdvanced = false) {
    const beat = this._current();
    const complete = beat == null;

    this.elEyebrow.textContent = complete ? 'Complete' : beat.eyebrow;
    this.elStep.textContent = complete ? '✓ done' : `Step ${this.i + 1} of ${this.beats.length}`;
    this.elObj.textContent = complete ? this.complete.title : beat.objective;
    this.elStory.textContent = complete ? '' : beat.story;

    this.elDots.innerHTML = this.beats.map((_, k) => {
      const cls = k < this.i ? 'done' : k === this.i ? 'active' : '';
      return `<span class="m-dot ${cls}"></span>`;
    }).join('');

    this.el.classList.toggle('complete', complete);
    if (justAdvanced) {
      this.el.classList.remove('flash');
      void this.el.offsetWidth;
      this.el.classList.add('flash');
    }

    this._renderHint();
    this._renderMeter();

    clearTimeout(this._hintTimer);
    if (!complete && beat.hint) {
      this._hintTimer = setTimeout(() => { this.hintShown = true; this._renderHint(); }, AUTO_HINT_MS);
    }
  }

  _renderMeter() {
    if (!this.elMeter) return;
    const beat = this._current();
    const kind = beat && beat.meter;
    if (!kind) { this.elMeter.style.display = 'none'; return; }
    this.elMeter.style.display = 'block';

    if (kind === 'count') {
      const target = this.state.flagTarget || 5;
      const got = Math.min(target, this.state.flaggedLow || 0);
      this.elMeterFill.style.width = ((got / target) * 100).toFixed(0) + '%';
      this.elMeterFill.style.background = '#ff3b5c';
      this.elMeterThresh.style.display = 'none';
      this.elMeterLabel.textContent = got >= target
        ? `Flagged ${got} / ${target} low-NDVI blocks ✓`
        : `Flagged ${got} / ${target} low-NDVI blocks`;
      return;
    }

    if (kind === 'coverage') {
      const c = Math.min(1, this.state.coverage || 0);
      this.elMeterFill.style.width = (c * 100).toFixed(0) + '%';
      this.elMeterFill.style.background = '#c2412f'; // ladybug red
      this.elMeterThresh.style.display = 'none';
      this.elMeterLabel.textContent = c >= 0.999
        ? 'Infestation treated: 100% ✓'
        : `Treated: ${Math.round(c * 100)}% of the infested plants`;
      return;
    }

    // stress meter
    const max = this.state.meterMax || 1;
    const fill = Math.min(1, (this.state.maxStress || 0) / max);
    const mark = Math.min(1, (this.state.meterThreshold || max) / max);
    this.elMeterThresh.style.display = 'block';
    this.elMeterFill.style.width = (fill * 100).toFixed(0) + '%';
    this.elMeterFill.style.background = `hsl(${Math.round((1 - fill) * 110)}, 72%, 46%)`;
    this.elMeterThresh.style.left = (mark * 100).toFixed(0) + '%';
    const pct = Math.round((this.state.maxStress || 0) * 100);
    const done = (this.state.maxStress || 0) >= (this.state.meterThreshold || 1);
    this.elMeterLabel.textContent = done
      ? `Worst found: ${pct}% stress — target reached ✓`
      : `Worst found: ${pct}% stress — reach the marker`;
  }

  _renderHint() {
    const beat = this._current();
    if (!beat || !beat.hint) { this.elHint.innerHTML = ''; return; }
    this.elHint.innerHTML = this.hintShown
      ? `<span class="m-hint-icon">💡</span> ${beat.hint} <span class="m-hint-key">(H to hide)</span>`
      : `<span class="m-hint-key">Stuck? Press <kbd>H</kbd> for a hint</span>`;
  }

  // --- completion text box (non-blocking; advance with Enter) ---
  _showDialogue() {
    if (!this.dlg) return;
    this.el.classList.remove('show'); // hand the top-centre slot to the box
    this.dlgTitle.textContent = this.complete.title;
    this.dlgBody.innerHTML = this.complete.body
      .split('\n\n').map((p) => `<p>${p}</p>`).join('');
    this.dlgBtn.innerHTML = `${this.complete.button} &nbsp; <kbd>Enter</kbd>`;
    this.dlg.classList.add('show');
    this.awaiting = true;
  }
  _hideDialogue() { if (this.dlg) this.dlg.classList.remove('show'); }
  /** Advance past a completion box (Enter or click). */
  proceed() {
    if (!this.awaiting) return;
    this.awaiting = false;
    this._hideDialogue();
    if (this.onLevelComplete) this.onLevelComplete(this.complete.next);
  }
}
