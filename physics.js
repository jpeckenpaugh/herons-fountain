// Lumped-pressure model of a Heron's fountain.
//
// Naming (side view, world units in meters, y up):
//   A = top open basin (you pour water in; the jet rises here)
//   B = bottom air/compression chamber (receives falling water via P1)
//   C = middle water/jet reservoir (its water is pushed up the nozzle via P3)
//
// Connections:
//   P1: basin A  -> bottom chamber B   (falling water compresses B's air)
//   P2: chamber B -> reservoir C       (compressed air pushes on C's water)
//   P3: reservoir C -> basin A         (fountain jet)
//
// Physics: incompressible water + isothermal ideal gas. Each sealed air
// pocket tracks n = P*V (Pa*m^3). Flows through orifices scale with the
// square root of the driving pressure difference.

const PHYS = {
  g: 9.81,
  rho: 1000,          // kg/m^3
  P_atm: 101325,      // Pa

  // A: top basin (open tray). Max water depth = maxDepth.
  A: { xL: 2.0, xR: 8.0, floor: 4.0, width: 6.0, maxDepth: 1.5 },

  // C: middle water/jet reservoir (box)
  C: { xL: 0.5, xR: 4.5, yB: 2.5, yT: 3.5, width: 4.0 },

  // B: bottom air/compression chamber (box)
  B: { xL: 5.5, xR: 9.5, yB: 1.5, yT: 2.5, width: 4.0 },

  // Fountain nozzle: exit position in the basin (x, y).
  nozzle: { x: 4.0, y: 4.6 },

  // Orifice "areas" (tuned conductance, not literal m^2)
  P1: 0.03,            // A -> B (water)
  P2: 6.0,             // B -> C (air), m^3/s per Pa
  P3: 0.004,           // C -> A (fountain)

  pourRate: 0.06,      // m^3/s of poured water
};

class HeronSim {
  constructor() {
    this.reset();
  }

  reset() {
    const { P_atm, B, C } = PHYS;
    this.W_A = 0.8 * PHYS.A.maxDepth;   // A 80% — pre-primed, fires on load
    this.W_B = 0.1 * (B.yT - B.yB);     // B 10% — large air reserve to compress
    this.W_C = 0.9 * (C.yT - C.yB);     // C 90% — jet source, small air pocket

    const V_B_air = B.width * (B.yT - B.yB - this.W_B);
    const V_C_air = C.width * (C.yT - C.yB - this.W_C);
    this.n_B = P_atm * V_B_air;    // n = P*V, starts at ambient
    this.n_C = P_atm * V_C_air;
    this.t = 0;
    this.exhausted = false;
  }

  // Air pocket volumes (m^3)
  airB() { const b = PHYS.B; return b.width * (b.yT - b.yB - this.W_B); }
  airC() { const c = PHYS.C; return c.width * (c.yT - c.yB - this.W_C); }

  // Absolute air pressures (Pa). Guard against dividing by a ~zero air pocket
  // (when a chamber is full of water and its air is exhausted).
  pB() { const a = this.airB(); return a > 1e-9 ? this.n_B / a : PHYS.P_atm; }
  pC() { const a = this.airC(); return a > 1e-9 ? this.n_C / a : PHYS.P_atm; }

  // Driving pressure for the fountain (P3) and the jet exit speed.
  fountainDeltaP() {
    const { g, rho, P_atm, C, nozzle } = PHYS;
    const inlet = this.pC() + rho * g * this.W_C;       // pressure at pipe P3 inlet (bottom of C)
    const head = P_atm + rho * g * (nozzle.y - C.yB);   // pressure needed to reach the nozzle
    return inlet - head;
  }

  fountainVelocity() {
    const dp = this.fountainDeltaP();
    return dp > 0 ? Math.sqrt(2 * dp / PHYS.rho) : 0;
  }

  // Advance simulation by dt seconds.
  step(dt) {
    const { g, rho, P_atm } = PHYS;
    const A_B = PHYS.B.width;     // cross-section area of B (per m depth)
    const A_C = PHYS.C.width;     // cross-section area of C
    const A_A = PHYS.A.width;     // cross-section area of A (basin)

    // --- P1: water basin A -> chamber B ---
    // Water falls from the open basin down the pipe into B. The driving head
    // includes the height drop between the basin floor and B's bottom.
    let inQ = 0;
    {
      const dropHead = PHYS.A.floor - PHYS.B.yB;
      const pBasinSide = P_atm + rho * g * (this.W_A + dropHead);
      const pBSide = this.pB() + rho * g * this.W_B;
      const dp = pBasinSide - pBSide;
      // A full B can't accept more water (sealed vessel, no air left to
      // compress), so stall the inflow once B's air is exhausted.
      if (dp > 0 && this.W_A > 1e-4 && this.airB() > 1e-9) {
        inQ = PHYS.P1 * Math.sqrt(2 * dp / rho);
        this.W_B += inQ / A_B * dt;
        this.W_A -= inQ / A_A * dt;
      }
    }

    // --- P2: compressed air B -> C ---
    {
      const dp = this.pB() - this.pC();
      if (dp > 0) {
        // Never extract more air than B actually holds (keeps n_B >= 0).
        const q = Math.min(PHYS.P2 * dp * dt, this.n_B);   // n units (Pa*m^3)
        this.n_B -= q;
        this.n_C += q;
      }
    }

    // --- P3: water C -> nozzle (the fountain) ---
    let jetQ = 0, jetV = 0;
    {
      const dp = this.fountainDeltaP();
      if (dp > 0 && this.W_C > 1e-4) {
        jetV = Math.sqrt(2 * dp / rho);
        jetQ = PHYS.P3 * jetV;
        this.W_C  -= jetQ / A_C * dt;
        this.W_A  += jetQ / A_A * dt;   // jet lands back in the basin
      }
    }

    // --- Poured water from the user ---
    if (this.pouring) {
      const add = PHYS.pourRate * dt;
      this.W_A = Math.min(this.W_A + add / A_A, PHYS.A.maxDepth);
    }

    // Clamp to physical bounds (air can't have negative volume).
    const hB = PHYS.B.yT - PHYS.B.yB;
    const hC = PHYS.C.yT - PHYS.C.yB;
    this.W_B  = Math.min(Math.max(this.W_B, 0), hB);
    this.W_C  = Math.min(Math.max(this.W_C, 0), hC);
    this.W_A  = Math.min(Math.max(this.W_A, 0), PHYS.A.maxDepth);
    this.exhausted = this.airB() <= 1e-9;   // B full of water, air gone

    this.t += dt;
    return { inQ, jetQ, jetV };
  }
}