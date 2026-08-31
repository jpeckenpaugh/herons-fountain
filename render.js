// 2D side-view rendering: draws the three chambers (A top, B bottom, C middle),
// the three pipes (P1/P2/P3), live water levels and pressures, and a
// particle-based fountain jet.

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const statsEl = document.getElementById('stats');
const gasPressureEl = document.getElementById('gas-pressure');
const sim = new HeronSim();

// ---- World -> screen transform (y world points up) ----
const WX = [0.0, 10.0];
const WY = [0.0, 6.0];
const SX = (x) => ((x - WX[0]) / (WX[1] - WX[0])) * canvas.width;
const SY = (y) => canvas.height - ((y - WY[0]) / (WY[1] - WY[0])) * canvas.height;
const SW = (dx) => dx / (WX[1] - WX[0]) * canvas.width;

// ---- Fountain particles ----
const drops = [];
let dropCarry = 0;
const DROPS_PER_CUBIC_METER = 8000;

function emitDrops(jetVolume, jetV) {
  const { nozzle, P3 } = PHYS;
  dropCarry += jetVolume * DROPS_PER_CUBIC_METER;
  const n = Math.floor(dropCarry);
  dropCarry -= n;
  const nozzleDiameter = P3.diameter;
  for (let i = 0; i < n; i++) {
    const ang = (-0.05 + Math.random() * 0.10) * (Math.PI / 2);
    const speed = jetV * (0.96 + Math.random() * 0.08);
    drops.push({
      x: nozzle.x + (Math.random() - 0.5) * nozzleDiameter,
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
    if (d.life <= 0 || landed) {
      drops.splice(i, 1);
    }
  }
}

// ---- Drawing helpers ----
function drawChamber(c) {
  ctx.strokeStyle = '#7d93ab';
  ctx.lineWidth = 3;
  ctx.strokeRect(SX(c.xL), SY(c.yT), SW(c.xR - c.xL), SY(c.yB) - SY(c.yT));
}

function drawBasin(a) {
  const top = a.floor + a.maxDepth;
  ctx.strokeStyle = '#7d93ab';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(SX(a.xL), SY(top));
  ctx.lineTo(SX(a.xL), SY(a.floor));
  ctx.lineTo(SX(a.xR), SY(a.floor));
  ctx.lineTo(SX(a.xR), SY(top));
  ctx.stroke();
}

function drawWater(xL, xR, yB, surface, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(SX(xL), SY(surface), SW(xR - xL), SY(yB) - SY(surface));
}

function drawPipe(pts, diameter = 0.05) {
  ctx.strokeStyle = '#8fa3b8';
  ctx.lineWidth = Math.max(3, SW(diameter));
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(SX(x), SY(y)) : ctx.moveTo(SX(x), SY(y))));
  ctx.stroke();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { A, B, C, nozzle, P1, P3 } = PHYS;

  // Pipes (behind water). P1: A->B, P2: B->C (air), P3: C->A (nozzle jet).
  drawPipe([[P1.x, P1.topY], [P1.x, P1.bottomY]], P1.diameter);
  drawPipe([[5.5, 2.5], [4.5, 3.5]]);
  drawPipe([[P3.x, P3.topY], [P3.x, P3.bottomY]], P3.diameter);

  // Live water levels, then vessel outlines. Labels are HTML overlays.
  drawWater(A.xL, A.xR, A.floor, sim.surfaceA(), 'rgba(70,160,255,0.55)');
  drawWater(C.xL, C.xR, C.yB, sim.surfaceC(), 'rgba(70,160,255,0.55)');
  drawWater(B.xL, B.xR, B.yB, sim.surfaceB(), 'rgba(70,160,255,0.45)');
  drawBasin(A);
  drawChamber(B);
  drawChamber(C);

  // P3 intake: the fountain de-primes when C falls below this elevation.
  ctx.fillStyle = '#dfe7ee';
  ctx.beginPath();
  ctx.arc(SX(nozzle.x), SY(P3.intakeY), 4, 0, Math.PI * 2);
  ctx.fill();

  // Fountain jet
  ctx.fillStyle = 'rgba(120,200,255,0.9)';
  const dropRadius = Math.max(1.5, SW(P3.diameter) * 0.22);
  for (const d of drops) {
    ctx.beginPath();
    ctx.arc(SX(d.x), SY(d.y), dropRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#dfe7ee';
  ctx.beginPath();
  ctx.arc(SX(nozzle.x), SY(nozzle.y), 4, 0, Math.PI * 2);
  ctx.fill();

  const gaugePressure = (sim.gasPressure() - PHYS.P_atm) / 1000;
  gasPressureEl.textContent = `${gaugePressure >= 0 ? '+' : ''}${gaugePressure.toFixed(1)} kPa`;

  const volA = sim.V_A;
  const volB = sim.V_B;
  const volC = sim.V_C;
  statsEl.textContent =
    (sim.ended ? 'Equilibrium reached — cycle ended. Reset to re-run.   ' : '') +
    `time ${sim.t.toFixed(1)}s · jet ${sim.fountainVelocity().toFixed(2)} m/s · ` +
    `basin ${volA.toFixed(1)} m³ (${(100 * sim.depthA() / A.maxDepth).toFixed(0)}%) · ` +
    `Chamber A ${volB.toFixed(1)} m³ (${(100 * sim.depthB() / (B.yT - B.yB)).toFixed(0)}%) · ` +
    `Chamber B ${volC.toFixed(1)} m³ (${(100 * sim.depthC() / (C.yT - C.yB)).toFixed(0)}%)` +
    (sim.spilledVolume > 0 ? ` · spilled ${sim.spilledVolume.toFixed(2)} m³` : '');
}

// ---- Controls ----
document.getElementById('pour').addEventListener('mousedown', () => (sim.pouring = true));
document.getElementById('pour').addEventListener('mouseup', () => (sim.pouring = false));
document.getElementById('pour').addEventListener('mouseleave', () => (sim.pouring = false));
document.getElementById('reset').addEventListener('click', () => {
  drops.length = 0;
  dropCarry = 0;
  sim.reset();
});
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { sim.pouring = true; e.preventDefault(); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') sim.pouring = false; });

// ---- Main loop ----
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  let jetVolume = 0;
  let jetV = 0;
  for (let i = 0; i < 4; i++) {
    const flow = sim.step(dt / 4);
    jetVolume += flow.jetQ * dt / 4;
    if (flow.jetV > 0) jetV = flow.jetV;
  }
  // A submerged nozzle transfers water into the basin without an airborne jet.
  if (sim.surfaceA() < PHYS.nozzle.y) emitDrops(jetVolume, jetV);
  updateDrops(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
