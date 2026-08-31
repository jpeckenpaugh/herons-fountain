// 2D side-view rendering: draws the three chambers (A top, B bottom, C middle),
// the three pipes (P1/P2/P3), live water levels and pressures, and a
// particle-based fountain jet.

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const statsEl = document.getElementById('stats');
const sim = new HeronSim();

// ---- World -> screen transform (y world points up) ----
const WX = [0.0, 10.0];
const WY = [0.0, 6.0];
const SX = (x) => ((x - WX[0]) / (WX[1] - WX[0])) * canvas.width;
const SY = (y) => canvas.height - ((y - WY[0]) / (WY[1] - WY[0])) * canvas.height;
const SW = (dx) => dx / (WX[1] - WX[0]) * canvas.width;

// ---- Fountain particles ----
const drops = [];
function emitDrops(jetV, dt) {
  const { nozzle } = PHYS;
  const n = Math.floor(jetV * 40 * dt);
  for (let i = 0; i < n; i++) {
    const ang = (-0.16 + Math.random() * 0.32) * (Math.PI / 2);
    const speed = jetV * (0.8 + Math.random() * 0.35);
    drops.push({
      x: nozzle.x, y: nozzle.y,
      vx: Math.sin(ang) * speed,
      vy: Math.cos(ang) * speed,
      life: 0.9 + Math.random() * 0.6,
    });
  }
  if (drops.length > 900) drops.splice(0, drops.length - 900);
}

function updateDrops(dt) {
  const { g, A } = PHYS;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.vy -= g * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.life -= dt;
    if (d.life <= 0 || (d.y < A.floor + 0.02 && d.x > A.xL && d.x < A.xR)) {
      drops.splice(i, 1);
    }
  }
}

// ---- Drawing helpers ----
function drawChamber(c, label) {
  ctx.strokeStyle = '#7d93ab';
  ctx.lineWidth = 3;
  ctx.strokeRect(SX(c.xL), SY(c.yT), SW(c.xR - c.xL), SY(c.yB) - SY(c.yT));
  ctx.fillStyle = '#dfe7ee';
  ctx.font = 'bold 15px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, SX(c.xL) + 6, SY(c.yT) + 6);
}

function drawWater(xL, xR, yB, surface, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(SX(xL), SY(surface), SW(xR - xL), SY(yB) - SY(surface));
}

function drawPipe(pts, label) {
  ctx.strokeStyle = '#8fa3b8';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(SX(x), SY(y)) : ctx.moveTo(SX(x), SY(y))));
  ctx.stroke();
  // Label near the midpoint of the pipe
  const midIdx = Math.floor(pts.length / 2);
  const [mx, my] = pts[midIdx];
  ctx.fillStyle = '#c9d6e2';
  ctx.font = 'bold 12px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, SX(mx), SY(my) - 4);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { A, B, C, nozzle } = PHYS;

  // Pipes (behind water). P1: A->B, P2: B->C (air), P3: C->A (nozzle jet).
  drawPipe([[6.0, 4.1], [6.0, 1.6]], 'P1');
  drawPipe([[5.5, 2.5], [4.5, 3.5]], 'P2');
  drawPipe([[4.0, 5.1], [4.0, 2.6]], 'P3');

  // Chambers + live water levels
  drawChamber(A, 'A · top basin');
  drawChamber(B, 'B · bottom air chamber');
  drawChamber(C, 'C · middle water chamber');

  drawWater(A.xL, A.xR, A.floor, A.floor + sim.W_A, 'rgba(70,160,255,0.55)');
  drawWater(C.xL, C.xR, C.yB, C.yB + sim.W_C, 'rgba(70,160,255,0.55)');
  drawWater(B.xL, B.xR, B.yB, B.yB + sim.W_B, 'rgba(70,160,255,0.45)');

  // Basin open top
  ctx.strokeStyle = '#7d93ab';
  ctx.lineWidth = 3;
  ctx.strokeRect(SX(A.xL), SY(A.floor + A.maxDepth), SW(A.xR - A.xL), SY(A.floor) - SY(A.floor + A.maxDepth));

  // Fountain jet
  ctx.fillStyle = 'rgba(120,200,255,0.9)';
  for (const d of drops) {
    ctx.beginPath();
    ctx.arc(SX(d.x), SY(d.y), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#dfe7ee';
  ctx.beginPath();
  ctx.arc(SX(nozzle.x), SY(nozzle.y), 4, 0, Math.PI * 2);
  ctx.fill();

  // Live pressure readouts
  ctx.font = '13px -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#8aa0b5';
  ctx.textAlign = 'left';
  ctx.fillText(`B  ΔP ${((sim.pB() - PHYS.P_atm) / 1000).toFixed(1)} kPa`, SX(B.xL), SY(B.yT) + 14);
  ctx.fillText(`C  ΔP ${((sim.pC() - PHYS.P_atm) / 1000).toFixed(1)} kPa`, SX(C.xL), SY(C.yT) + 14);

  const volA = A.width * sim.W_A;
  const volB = B.width * sim.W_B;
  const volC = C.width * sim.W_C;
  statsEl.textContent =
    (sim.exhausted ? 'B full — cycle ended. Reset to re-run.   ' : '') +
    `time ${sim.t.toFixed(1)}s · jet ${sim.fountainVelocity().toFixed(2)} m/s · ` +
    `A ${volA.toFixed(1)} m³ (${(100 * sim.W_A / A.maxDepth).toFixed(0)}%) · ` +
    `B ${volB.toFixed(1)} m³ (${(100 * sim.W_B / (B.yT - B.yB)).toFixed(0)}%) · ` +
    `C ${volC.toFixed(1)} m³ (${(100 * sim.W_C / (C.yT - C.yB)).toFixed(0)}%)`;
}

// ---- Controls ----
document.getElementById('pour').addEventListener('mousedown', () => (sim.pouring = true));
document.getElementById('pour').addEventListener('mouseup', () => (sim.pouring = false));
document.getElementById('pour').addEventListener('mouseleave', () => (sim.pouring = false));
document.getElementById('reset').addEventListener('click', () => { drops.length = 0; sim.reset(); });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { sim.pouring = true; e.preventDefault(); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') sim.pouring = false; });

// ---- Main loop ----
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  for (let i = 0; i < 4; i++) sim.step(dt / 4);   // substeps for stability
  emitDrops(sim.fountainVelocity(), dt);
  updateDrops(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);