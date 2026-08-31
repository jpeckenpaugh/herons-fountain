// Lumped-pressure model of a Heron's fountain.
//
// Naming (side view, world units in meters, y up):
//   A = top open basin (you pour water in; the jet rises here)
//   B = bottom compression chamber (receives falling water through P1)
//   C = middle jet reservoir (its water is pushed through P3)
//
// The air spaces in B and C are connected through P2 and are treated as one
// isothermal gas volume. Water is incompressible, and pipe flows use a simple
// orifice approximation Q = Cd * area * sqrt(2 * deltaP / rho).

// A 1:10 linear scale turns the original installation-sized geometry into a
// bench model. Areas scale by 1:100 and volumes by 1:1000.
const LENGTH_SCALE = 0.1;
const AREA_SCALE = LENGTH_SCALE ** 2;
const VOLUME_SCALE = LENGTH_SCALE ** 3;
const FLOW_SCALE = LENGTH_SCALE ** 2.5;

// P1 and P3 are intentionally identical. Their 7.14 mm internal diameter is
// derived from the scaled 0.00004 m^2 flow area.
const LIQUID_PIPE_AREA = 0.004 * AREA_SCALE;
const LIQUID_PIPE_DIAMETER = Math.sqrt(4 * LIQUID_PIPE_AREA / Math.PI);
const LIQUID_PIPE_LENGTH = 2.5 * LENGTH_SCALE;
const LIQUID_PIPE_DISCHARGE_COEFFICIENT = 0.75;

const PHYS = {
  g: 9.81,
  rho: 1000,          // kg/m^3
  P_atm: 101325,      // Pa
  lengthScale: LENGTH_SCALE,
  world: { xMin: 0, xMax: 1.0, yMin: 0, yMax: 0.6 },

  // crossSectionArea is the physical area perpendicular to the side view.
  A: {
    xL: 0.25, xR: 0.75, floor: 0.4, maxDepth: 0.16,
    crossSectionArea: 0.05,
  },
  C: {
    xL: 0.05, xR: 0.45, yB: 0.25, yT: 0.35,
    crossSectionArea: 0.04,
  },
  B: {
    xL: 0.55, xR: 0.95, yB: 0.15, yT: 0.25,
    crossSectionArea: 0.04,
  },

  nozzle: { x: 0.4, y: 0.51 },

  // Cd is a lumped loss term in this approximation. Matching Cd, diameter,
  // and length gives P1 and P3 the same hydraulic resistance. P2 is the air
  // equalizer and is assumed to have negligible pressure drop.
  P1: {
    area: LIQUID_PIPE_AREA,
    diameter: LIQUID_PIPE_DIAMETER,
    length: LIQUID_PIPE_LENGTH,
    dischargeCoefficient: LIQUID_PIPE_DISCHARGE_COEFFICIENT,
    x: 0.6,
    topY: 0.41,
    bottomY: 0.16,
  },
  P3: {
    area: LIQUID_PIPE_AREA,
    diameter: LIQUID_PIPE_DIAMETER,
    length: LIQUID_PIPE_LENGTH,
    dischargeCoefficient: LIQUID_PIPE_DISCHARGE_COEFFICIENT,
    x: 0.4,
    topY: 0.51,
    bottomY: 0.26,
    intakeY: 0.26,
  },
  P2: {
    diameter: 0.005,
    start: { x: 0.55, y: 0.25 },
    end: { x: 0.45, y: 0.35 },
  },

  airTubeVolume: 0.05 * VOLUME_SCALE, // 50 mL gas dead volume in P2
  gasExponent: 1.0,    // 1.0 = isothermal; 1.4 would be adiabatic air
  pourRate: 0.00015,   // 150 mL/s of externally poured water

  stopFlowRate: 1e-5 * FLOW_SCALE, // m^3/s
  stopPressure: 10 * LENGTH_SCALE, // Pa
  stopDelay: 0.5,      // seconds at equilibrium before declaring the end
};

function chamberCapacity(chamber) {
  return chamber.crossSectionArea * (chamber.yT - chamber.yB);
}

function basinCapacity() {
  return PHYS.A.crossSectionArea * PHYS.A.maxDepth;
}

function orificeFlow(pipe, deltaP) {
  if (deltaP <= 0) return 0;
  return pipe.dischargeCoefficient * pipe.area *
    Math.sqrt(2 * deltaP / PHYS.rho);
}

class HeronSim {
  constructor() {
    this.reset();
  }

  reset() {
    const { A, B, C, P_atm } = PHYS;

    // Volumes are the conserved state. Depths are derived for pressure and
    // rendering, which keeps every transfer explicitly volume-for-volume.
    this.V_A = A.crossSectionArea * 0.5 * A.maxDepth;
    this.V_B = B.crossSectionArea * 0.1 * (B.yT - B.yB);
    this.V_C = C.crossSectionArea * 0.9 * (C.yT - C.yB);

    this.initialGasVolume = this.gasVolume();
    this.initialGasPressure = P_atm;
    this.pouring = false;
    this.pouredVolume = 0;
    this.spilledVolume = 0;
    this.lowFlowTime = 0;
    this.t = 0;
    this.ended = false;
  }

  depthA() { return this.V_A / PHYS.A.crossSectionArea; }
  depthB() { return this.V_B / PHYS.B.crossSectionArea; }
  depthC() { return this.V_C / PHYS.C.crossSectionArea; }

  surfaceA() { return PHYS.A.floor + this.depthA(); }
  surfaceB() { return PHYS.B.yB + this.depthB(); }
  surfaceC() { return PHYS.C.yB + this.depthC(); }

  airB() { return chamberCapacity(PHYS.B) - this.V_B; }
  airC() { return chamberCapacity(PHYS.C) - this.V_C; }
  gasVolume() { return this.airB() + this.airC() + PHYS.airTubeVolume; }

  gasPressure() {
    const volumeRatio = this.initialGasVolume / this.gasVolume();
    return this.initialGasPressure * Math.pow(volumeRatio, PHYS.gasExponent);
  }

  // Compatibility helpers used by the pressure labels.
  pB() { return this.gasPressure(); }
  pC() { return this.gasPressure(); }

  inletDeltaP() {
    const { g, rho, P_atm } = PHYS;
    return P_atm + rho * g * this.surfaceA() -
      (this.gasPressure() + rho * g * this.surfaceB());
  }

  fountainDeltaP() {
    const { g, rho, P_atm, nozzle } = PHYS;
    // If the basin rises above the nozzle, the outlet sees the basin's
    // hydrostatic pressure instead of atmospheric pressure.
    const outletHeadY = Math.max(nozzle.y, this.surfaceA());
    return this.gasPressure() + rho * g * this.surfaceC() -
      (P_atm + rho * g * outletHeadY);
  }

  fountainVelocity() {
    const dp = this.fountainDeltaP();
    return dp > 0 ? Math.sqrt(2 * dp / PHYS.rho) : 0;
  }

  fountainPrimed() {
    return this.surfaceC() > PHYS.P3.intakeY + 1e-9;
  }

  // Advance all flows from one state snapshot, then apply the corresponding
  // volume transfers together. This avoids ordering bias within a time step.
  step(dt) {
    const capacityA = basinCapacity();
    const capacityB = chamberCapacity(PHYS.B);

    const inletDp = this.inletDeltaP();
    const fountainDp = this.fountainDeltaP();
    const requestedInQ = orificeFlow(PHYS.P1, inletDp);
    const requestedJetQ = this.fountainPrimed()
      ? orificeFlow(PHYS.P3, fountainDp)
      : 0;

    const inVolume = Math.min(
      requestedInQ * dt,
      this.V_A,
      Math.max(0, capacityB - this.V_B),
    );

    // Leave the water below the P3 intake in C; once exposed, the fountain
    // pipe admits air and is considered de-primed.
    const retainedC = PHYS.C.crossSectionArea *
      Math.max(0, PHYS.P3.intakeY - PHYS.C.yB);
    const jetVolume = Math.min(
      requestedJetQ * dt,
      Math.max(0, this.V_C - retainedC),
    );

    const pouredVolume = this.pouring ? PHYS.pourRate * dt : 0;
    this.pouredVolume += pouredVolume;

    this.V_B += inVolume;
    this.V_C -= jetVolume;
    this.V_A += jetVolume - inVolume + pouredVolume;

    // A is open: water that cannot fit spills out rather than disappearing or
    // artificially stopping the fountain flow.
    const overflow = Math.max(0, this.V_A - capacityA);
    this.V_A -= overflow;
    this.spilledVolume += overflow;

    const inQ = dt > 0 ? inVolume / dt : 0;
    const jetQ = dt > 0 ? jetVolume / dt : 0;
    const jetV = jetQ > 0 ? Math.sqrt(2 * Math.max(0, fountainDp) / PHYS.rho) : 0;

    const nearEquilibrium =
      !this.pouring &&
      inQ < PHYS.stopFlowRate &&
      jetQ < PHYS.stopFlowRate &&
      inletDp <= PHYS.stopPressure &&
      (fountainDp <= PHYS.stopPressure || !this.fountainPrimed());
    this.lowFlowTime = nearEquilibrium ? this.lowFlowTime + dt : 0;
    this.ended = this.lowFlowTime >= PHYS.stopDelay;

    this.t += dt;
    return { inQ, jetQ, jetV, overflow };
  }
}
