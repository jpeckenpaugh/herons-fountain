// 2D side-view rendering for the reversible Heron's fountain.

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const sceneWrap = document.querySelector('.scene-wrap');
const statsEl = document.getElementById('stats');
const gasPressureEl = document.getElementById('gas-pressure');
const chamberALabel = document.querySelector('.label-b');
const chamberBLabel = document.querySelector('.label-c');
const p1Label = document.querySelector('.label-p1');
const p3Label = document.querySelector('.label-p3');
const nozzleLabel = document.querySelector('.label-nozzle');
const intakeLabel = document.querySelector('.label-intake');
const invertButton = document.getElementById('invert');
const autoInvertButton = document.getElementById('auto-invert');
const autoTriggerSelect = document.getElementById('auto-trigger');
const thresholdControl = document.getElementById('threshold-control');
const triggerThresholdInput = document.getElementById('trigger-threshold');
const triggerUnit = document.getElementById('trigger-unit');
const triggerDwellInput = document.getElementById('trigger-dwell');
const speedButton = document.getElementById('speed');
const aboutButton = document.getElementById('about');
const aboutDialog = document.getElementById('about-dialog');
const closeAboutButton = document.getElementById('close-about');
const controlHint = document.getElementById('control-hint');
const sim = new HeronSim();
const autoTrigger = new AutoInvertTrigger(sim);

const SPEED_MULTIPLIERS = [1, 2, 4, 8, 16];
const PHYSICS_STEP = 1 / 120;
const MAX_PHYSICS_STEPS_PER_FRAME = 128;
let speedIndex = 0;
let autoInvertEnabled = true;
let physicsAccumulator = 0;
let currentJetFlowMlPerSecond = 0;

const TRIGGER_CONFIG = {
  'jet-speed': { label: 'Jet speed', defaultValue: 0.25, min: 0.05, max: 1, step: 0.05, unit: 'm/s' },
  'jet-flow': { label: 'Jet flow', defaultValue: 7.5, min: 1, max: 30, step: 0.5, unit: 'mL/s' },
  'receiver-fill': { label: 'Lower chamber', defaultValue: 75, min: 20, max: 90, step: 5, unit: '%' },
  'source-fill': { label: 'Source chamber', defaultValue: 25, min: 10, max: 80, step: 5, unit: '%' },
  'cycle-time': { label: 'Cycle time', defaultValue: 120, min: 10, max: 300, step: 10, unit: 's' },
  settled: { label: 'Settled', defaultValue: 0, unit: '' },
};

function triggerSettings() {
  const config = TRIGGER_CONFIG[autoTriggerSelect.value];
  const enteredThreshold = Number(triggerThresholdInput.value);
  const enteredDwell = Number(triggerDwellInput.value);
  return {
    mode: autoTriggerSelect.value,
    threshold: Number.isFinite(enteredThreshold)
      ? Math.min(config.max ?? enteredThreshold, Math.max(config.min ?? enteredThreshold, enteredThreshold))
      : config.defaultValue,
    dwell: Number.isFinite(enteredDwell)
      ? Math.min(5, Math.max(0, enteredDwell))
      : 0.5,
  };
}

function acceptTriggerInputs() {
  const settings = triggerSettings();
  triggerThresholdInput.value = settings.threshold;
  triggerDwellInput.value = settings.dwell;
  autoTrigger.reset();
}

function configureTriggerInputs(resetValue = true) {
  const config = TRIGGER_CONFIG[autoTriggerSelect.value];
  const hasThreshold = autoTriggerSelect.value !== 'settled';
  thresholdControl.hidden = !hasThreshold;
  triggerDwellInput.disabled = !hasThreshold;
  if (hasThreshold) {
    triggerThresholdInput.min = config.min;
    triggerThresholdInput.max = config.max;
    triggerThresholdInput.step = config.step;
    if (resetValue) triggerThresholdInput.value = config.defaultValue;
    triggerUnit.textContent = config.unit;
  }
  autoTrigger.reset();
}

function triggerDescription() {
  const settings = triggerSettings();
  if (settings.mode === 'settled') return 'when the system settles';
  const config = TRIGGER_CONFIG[settings.mode];
  const relation = settings.mode === 'source-fill' || settings.mode.startsWith('jet-')
    ? '≤'
    : '≥';
  const dwellText = settings.dwell > 0 ? ` for ${settings.dwell} s` : '';
  return `${config.label} ${relation} ${settings.threshold} ${config.unit}${dwellText}`;
}

// ---- World -> screen transform (y world points up) ----
const WX = [PHYS.world.xMin, PHYS.world.xMax];
const WY = [PHYS.world.yMin, PHYS.world.yMax];
const SX = (x) => ((x - WX[0]) / (WX[1] - WX[0])) * canvas.width;
const SY = (y) => canvas.height - ((y - WY[0]) / (WY[1] - WY[0])) * canvas.height;
const SW = (dx) => dx / (WX[1] - WX[0]) * canvas.width;
const XP = (x) => 100 * (x - WX[0]) / (WX[1] - WX[0]);
const YP = (y) => 100 * (WY[1] - y) / (WY[1] - WY[0]);

// ---- Fountain particles ----
const drops = [];
let dropCarry = 0;
const DROPS_PER_CUBIC_METER = 8000 / Math.pow(PHYS.lengthScale, 2.5);

function emitDrops(jetVolume, jetV, nozzle) {
  dropCarry += jetVolume * DROPS_PER_CUBIC_METER;
  const n = Math.floor(dropCarry);
  dropCarry -= n;
  for (let i = 0; i < n; i++) {
    const ang = (-0.05 + Math.random() * 0.10) * (Math.PI / 2);
    const speed = jetV * (0.96 + Math.random() * 0.08);
    drops.push({
      x: nozzle.x + (Math.random() - 0.5) * nozzle.diameter,
      y: nozzle.y,
      vx: Math.sin(ang) * speed,
      vy: Math.cos(ang) * speed,
      life: 3,
    });
  }
  if (drops.length > 900) drops.splice(0, drops.length - 900);
}

function updateDrops(dt) {
  const { g, A } = PHYS;
  const waterSurface = sim.surfaceA();
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.vy -= g * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.life -= dt;
    const landed = d.vy < 0 && d.y <= waterSurface && d.x > A.xL && d.x < A.xR;
    if (d.life <= 0 || landed) drops.splice(i, 1);
  }
}

// ---- Moving geometry ----
function visualGeometry() {
  const factor = sim.visualOrientationFactor();
  const chamberAShift = PHYS.inversionTravel * factor;
  const chamberBShift = -PHYS.inversionTravel * factor;
  const chamberA = {
    ...PHYS.B,
    yB: PHYS.B.yB + chamberAShift,
    yT: PHYS.B.yT + chamberAShift,
  };
  const chamberB = {
    ...PHYS.C,
    yB: PHYS.C.yB + chamberBShift,
    yT: PHYS.C.yT + chamberBShift,
  };
  const p1 = {
    ...PHYS.P1,
    topY: PHYS.P1.topY + chamberAShift,
    bottomY: PHYS.P1.bottomY + chamberAShift,
  };
  const p3 = {
    ...PHYS.P3,
    topY: PHYS.P3.topY + chamberBShift,
    bottomY: PHYS.P3.bottomY + chamberBShift,
  };
  const p2 = {
    ...PHYS.P2,
    start: { x: PHYS.P2.start.x, y: PHYS.P2.start.y + chamberAShift },
    end: { x: PHYS.P2.end.x, y: PHYS.P2.end.y + chamberBShift },
  };
  return { chamberA, chamberB, p1, p2, p3 };
}

function activeJetGeometry(geometry) {
  const pipe = sim.isNormal() ? geometry.p3 : geometry.p1;
  return {
    x: pipe.x,
    y: pipe.topY,
    intakeY: pipe.bottomY,
    diameter: pipe.diameter,
  };
}

function positionEndpointLabel(label, pipe) {
  const isLeftPipe = pipe.x < 0.5;
  label.style.left = `${XP(pipe.x) + (isLeftPipe ? 1 : -1)}%`;
  label.style.top = `${YP(pipe.topY)}%`;
  label.style.transform = isLeftPipe
    ? 'translateY(-50%)'
    : 'translate(-100%, -50%)';
}

function updateOverlay(geometry) {
  sceneWrap.style.setProperty('--chamber-a-top', `${YP(geometry.chamberA.yT) - 5.1}%`);
  sceneWrap.style.setProperty('--chamber-b-top', `${YP(geometry.chamberB.yT) - 5.1}%`);
  sceneWrap.style.setProperty('--p1-top', `${YP((geometry.p1.topY + geometry.p1.bottomY) / 2) - 4.5}%`);
  sceneWrap.style.setProperty('--p3-top', `${YP((geometry.p3.topY + geometry.p3.bottomY) / 2) - 2.8}%`);

  const featuresHidden = sim.transitioning;
  nozzleLabel.classList.toggle('is-hidden', featuresHidden);
  intakeLabel.classList.toggle('is-hidden', featuresHidden);
  if (!featuresHidden) {
    const jetPipe = sim.isNormal() ? geometry.p3 : geometry.p1;
    const drainPipe = sim.isNormal() ? geometry.p1 : geometry.p3;
    positionEndpointLabel(nozzleLabel, jetPipe);
    positionEndpointLabel(intakeLabel, drainPipe);
  }

  p1Label.textContent = sim.isNormal() ? 'P1 ↓' : 'P1 ↑';
  p3Label.textContent = sim.isNormal() ? 'P3 ↑' : 'P3 ↓';

  invertButton.textContent = sim.transitioning ? 'Inverting…' : 'Invert';
  invertButton.disabled = sim.transitioning;
  if (sim.transitioning) controlHint.textContent = 'Physics paused while the chambers exchange positions.';
  else if (sim.ended && !autoInvertEnabled) controlHint.textContent = 'System settled. Invert when ready.';
  else if (autoInvertEnabled) controlHint.textContent = `Auto Invert ${triggerDescription()}. Manual inversion is available at any time.`;
  else controlHint.textContent = 'Manual inversion is available at any time.';

  chamberALabel.setAttribute('aria-label', `Chamber A, ${sim.isNormal() ? 'lower receiver' : 'upper jet source'}`);
  chamberBLabel.setAttribute('aria-label', `Chamber B, ${sim.isNormal() ? 'upper jet source' : 'lower receiver'}`);
}

// ---- Drawing helpers ----
function drawChamber(chamber) {
  ctx.strokeStyle = '#7d93ab';
  ctx.lineWidth = 3;
  ctx.strokeRect(
    SX(chamber.xL),
    SY(chamber.yT),
    SW(chamber.xR - chamber.xL),
    SY(chamber.yB) - SY(chamber.yT),
  );
}

function drawBasin(basin) {
  const top = basin.floor + basin.maxDepth;
  ctx.strokeStyle = '#7d93ab';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(SX(basin.xL), SY(top));
  ctx.lineTo(SX(basin.xL), SY(basin.floor));
  ctx.lineTo(SX(basin.xR), SY(basin.floor));
  ctx.lineTo(SX(basin.xR), SY(top));
  ctx.stroke();
}

function drawWater(xL, xR, yB, surface, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(SX(xL), SY(surface), SW(xR - xL), SY(yB) - SY(surface));
}

function drawPipe(points, diameter = 0.005) {
  ctx.strokeStyle = '#8fa3b8';
  ctx.lineWidth = Math.max(3, SW(diameter));
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => (
    i ? ctx.lineTo(SX(x), SY(y)) : ctx.moveTo(SX(x), SY(y))
  ));
  ctx.stroke();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { A, B, C } = PHYS;
  const geometry = visualGeometry();
  updateOverlay(geometry);

  // P2 is a flexible tube whose endpoints remain attached to both chambers.
  drawPipe([[geometry.p1.x, geometry.p1.topY], [geometry.p1.x, geometry.p1.bottomY]], geometry.p1.diameter);
  drawPipe([[geometry.p2.start.x, geometry.p2.start.y], [geometry.p2.end.x, geometry.p2.end.y]], geometry.p2.diameter);
  drawPipe([[geometry.p3.x, geometry.p3.topY], [geometry.p3.x, geometry.p3.bottomY]], geometry.p3.diameter);

  drawWater(A.xL, A.xR, A.floor, sim.surfaceA(), 'rgba(70,160,255,0.55)');
  drawWater(
    geometry.chamberB.xL,
    geometry.chamberB.xR,
    geometry.chamberB.yB,
    geometry.chamberB.yB + sim.depthC(),
    'rgba(70,160,255,0.55)',
  );
  drawWater(
    geometry.chamberA.xL,
    geometry.chamberA.xR,
    geometry.chamberA.yB,
    geometry.chamberA.yB + sim.depthB(),
    'rgba(70,160,255,0.45)',
  );
  drawBasin(A);
  drawChamber(geometry.chamberA);
  drawChamber(geometry.chamberB);

  if (!sim.transitioning) {
    const jet = activeJetGeometry(geometry);
    ctx.fillStyle = '#dfe7ee';
    ctx.beginPath();
    ctx.arc(SX(jet.x), SY(jet.intakeY), 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(120,200,255,0.9)';
    const dropRadius = Math.max(1.5, SW(jet.diameter) * 0.22);
    for (const drop of drops) {
      ctx.beginPath();
      ctx.arc(SX(drop.x), SY(drop.y), dropRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#dfe7ee';
    ctx.beginPath();
    ctx.arc(SX(jet.x), SY(jet.y), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const gaugePressure = (sim.gasPressure() - PHYS.P_atm) / 1000;
  gasPressureEl.textContent = `${gaugePressure >= 0 ? '+' : ''}${gaugePressure.toFixed(1)} kPa`;

  const liters = (volume) => volume * 1000;
  const status = sim.transitioning
    ? 'Inverting — physics paused.   '
    : sim.ended
      ? 'System settled.   '
      : '';
  const displayedJetVelocity = sim.transitioning ? 0 : sim.fountainVelocity();
  const displayedJetFlow = sim.transitioning ? 0 : currentJetFlowMlPerSecond;
  statsEl.textContent =
    status +
    `Time ${sim.t.toFixed(1)}s · Jet ${displayedJetVelocity.toFixed(2)} m/s (${displayedJetFlow.toFixed(1)} mL/s) · ` +
    `Basin ${liters(sim.V_A).toFixed(1)} L (${(100 * sim.depthA() / A.maxDepth).toFixed(0)}%) · ` +
    `Chamber A ${liters(sim.V_B).toFixed(1)} L (${(100 * sim.depthB() / (B.yT - B.yB)).toFixed(0)}%) · ` +
    `Chamber B ${liters(sim.V_C).toFixed(1)} L (${(100 * sim.depthC() / (C.yT - C.yB)).toFixed(0)}%)` +
    (sim.spilledVolume > 0 ? ` · Spilled ${liters(sim.spilledVolume).toFixed(1)} L` : '');
}

// ---- Controls ----
invertButton.addEventListener('click', () => {
  if (!sim.beginInversion()) return;
  physicsAccumulator = 0;
  currentJetFlowMlPerSecond = 0;
  autoTrigger.reset();
  drops.length = 0;
  dropCarry = 0;
});

autoTriggerSelect.addEventListener('change', () => configureTriggerInputs(true));
triggerThresholdInput.addEventListener('change', acceptTriggerInputs);
triggerDwellInput.addEventListener('change', acceptTriggerInputs);

autoInvertButton.addEventListener('click', () => {
  autoInvertEnabled = !autoInvertEnabled;
  autoInvertButton.setAttribute('aria-pressed', String(autoInvertEnabled));
  autoInvertButton.textContent = `Auto Invert: ${autoInvertEnabled ? 'On' : 'Off'}`;
  autoInvertButton.dataset.tooltip = autoInvertEnabled
    ? 'Turn off automatic inversion. Manual inversion remains available.'
    : 'Turn on automatic inversion using the configured trigger.';
});

speedButton.addEventListener('click', () => {
  speedIndex = (speedIndex + 1) % SPEED_MULTIPLIERS.length;
  speedButton.textContent = `Speed: ${SPEED_MULTIPLIERS[speedIndex]}×`;
});

aboutButton.addEventListener('click', () => aboutDialog.showModal());
closeAboutButton.addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => {
  const bounds = aboutDialog.getBoundingClientRect();
  const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
    event.clientY < bounds.top || event.clientY > bounds.bottom;
  if (outside) aboutDialog.close();
});

document.getElementById('reset').addEventListener('click', () => {
  physicsAccumulator = 0;
  currentJetFlowMlPerSecond = 0;
  drops.length = 0;
  dropCarry = 0;
  sim.reset();
  autoTrigger.reset();
});

// ---- Main loop ----
let last = performance.now();
function frame(now) {
  const realDt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (sim.transitioning) {
    physicsAccumulator = 0;
    if (sim.advanceInversion(realDt)) autoTrigger.reset();
  } else {
    physicsAccumulator += realDt * SPEED_MULTIPLIERS[speedIndex];
    let steps = 0;
    while (physicsAccumulator >= PHYSICS_STEP && steps < MAX_PHYSICS_STEPS_PER_FRAME) {
      const flow = sim.step(PHYSICS_STEP);
      currentJetFlowMlPerSecond = flow.jetQ * 1e6;
      if (flow.jetQ > 0 && sim.surfaceA() < PHYS.nozzle.y) {
        const geometry = visualGeometry();
        emitDrops(
          flow.jetQ * PHYSICS_STEP,
          flow.jetV,
          activeJetGeometry(geometry),
        );
      }
      updateDrops(PHYSICS_STEP);
      physicsAccumulator -= PHYSICS_STEP;
      steps++;

      const triggerReached = autoTrigger.update(
        flow,
        PHYSICS_STEP,
        triggerSettings(),
      );
      if (triggerReached && autoInvertEnabled) {
        sim.beginInversion();
        physicsAccumulator = 0;
        currentJetFlowMlPerSecond = 0;
        autoTrigger.reset();
        drops.length = 0;
        dropCarry = 0;
        break;
      }
    }
  }
  draw();
  requestAnimationFrame(frame);
}
configureTriggerInputs(false);
requestAnimationFrame(frame);
