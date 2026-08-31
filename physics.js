// Lumped-pressure model of a Heron's fountain.
//
// Naming (side view, world units in meters, y up):
//   A = top open basin
//   B = Chamber A (right)
//   C = Chamber B (left)
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

  nozzle: { y: 0.51 },
  inversionTravel: 0.1,
  inversionDuration: 1.0,

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
    intakeOffset: 0.01,
  },
  P3: {
    area: LIQUID_PIPE_AREA,
    diameter: LIQUID_PIPE_DIAMETER,
    length: LIQUID_PIPE_LENGTH,
    dischargeCoefficient: LIQUID_PIPE_DISCHARGE_COEFFICIENT,
    x: 0.4,
    topY: 0.51,
    bottomY: 0.26,
    intakeOffset: 0.01,
  },
  P2: {
    diameter: 0.005,
    start: { x: 0.55, y: 0.25 },
    end: { x: 0.45, y: 0.35 },
  },

  airTubeVolume: 0.05 * VOLUME_SCALE, // 50 mL gas dead volume in P2
  gasExponent: 1.0,    // 1.0 = isothermal; 1.4 would be adiabatic air

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
    this.spilledVolume = 0;
    this.lowFlowTime = 0;
    this.t = 0;
    this.ended = false;
    this.orientation = 'normal';
    this.transitioning = false;
    this.transitionElapsed = 0;
    this.transitionTarget = 'inverted';
  }

  depthA() { return this.V_A / PHYS.A.crossSectionArea; }
  depthB() { return this.V_B / PHYS.B.crossSectionArea; }
  depthC() { return this.V_C / PHYS.C.crossSectionArea; }

  surfaceA() { return PHYS.A.floor + this.depthA(); }
  orientationFactor() { return this.orientation === 'inverted' ? 1 : 0; }

  visualOrientationFactor() {
    if (!this.transitioning) return this.orientationFactor();
    const start = this.orientationFactor();
    const target = this.transitionTarget === 'inverted' ? 1 : 0;
    const t = Math.min(1, this.transitionElapsed / PHYS.inversionDuration);
    const eased = t * t * (3 - 2 * t);
    return start + (target - start) * eased;
  }

  chamberABottom(factor = this.orientationFactor()) {
    return PHYS.B.yB + PHYS.inversionTravel * factor;
  }

  chamberBBottom(factor = this.orientationFactor()) {
    return PHYS.C.yB - PHYS.inversionTravel * factor;
  }

  surfaceB() { return this.chamberABottom() + this.depthB(); }
  surfaceC() { return this.chamberBBottom() + this.depthC(); }

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

  isNormal() { return this.orientation === 'normal'; }
  receiverKey() { return this.isNormal() ? 'B' : 'C'; }
  sourceKey() { return this.isNormal() ? 'C' : 'B'; }
  receiverConfig() { return this.isNormal() ? PHYS.B : PHYS.C; }
  sourceConfig() { return this.isNormal() ? PHYS.C : PHYS.B; }
  drainPipe() { return this.isNormal() ? PHYS.P1 : PHYS.P3; }
  jetPipe() { return this.isNormal() ? PHYS.P3 : PHYS.P1; }
  receiverSurface() { return this.isNormal() ? this.surfaceB() : this.surfaceC(); }
  sourceSurface() { return this.isNormal() ? this.surfaceC() : this.surfaceB(); }
  receiverVolume() { return this.isNormal() ? this.V_B : this.V_C; }
  sourceVolume() { return this.isNormal() ? this.V_C : this.V_B; }

  inletDeltaP() {
    const { g, rho, P_atm } = PHYS;
    return P_atm + rho * g * this.surfaceA() -
      (this.gasPressure() + rho * g * this.receiverSurface());
  }

  fountainDeltaP() {
    const { g, rho, P_atm, nozzle } = PHYS;
    // If the basin rises above the nozzle, the outlet sees the basin's
    // hydrostatic pressure instead of atmospheric pressure.
    const outletHeadY = Math.max(nozzle.y, this.surfaceA());
    return this.gasPressure() + rho * g * this.sourceSurface() -
      (P_atm + rho * g * outletHeadY);
  }

  fountainVelocity() {
    const dp = this.fountainDeltaP();
    return dp > 0 ? Math.sqrt(2 * dp / PHYS.rho) : 0;
  }

  fountainPrimed() {
    const sourceDepth = this.sourceVolume() / this.sourceConfig().crossSectionArea;
    return sourceDepth > this.jetPipe().intakeOffset + 1e-9;
  }

  beginInversion() {
    if (this.transitioning) return false;
    this.transitioning = true;
    this.transitionElapsed = 0;
    this.transitionTarget = this.isNormal() ? 'inverted' : 'normal';
    return true;
  }

  advanceInversion(dt) {
    if (!this.transitioning) return false;
    this.transitionElapsed = Math.min(
      this.transitionElapsed + dt,
      PHYS.inversionDuration,
    );
    if (this.transitionElapsed < PHYS.inversionDuration) return false;

    this.orientation = this.transitionTarget;
    this.transitioning = false;
    this.transitionElapsed = 0;
    this.lowFlowTime = 0;
    this.ended = false;
    return true;
  }

  // Advance all flows from one state snapshot, then apply the corresponding
  // volume transfers together. This avoids ordering bias within a time step.
  step(dt) {
    if (this.transitioning) return { inQ: 0, jetQ: 0, jetV: 0, overflow: 0 };

    const capacityA = basinCapacity();
    const receiverCapacity = chamberCapacity(this.receiverConfig());
    const receiverVolume = this.receiverVolume();
    const sourceVolume = this.sourceVolume();
    const drainPipe = this.drainPipe();
    const jetPipe = this.jetPipe();

    const inletDp = this.inletDeltaP();
    const fountainDp = this.fountainDeltaP();
    const requestedInQ = orificeFlow(drainPipe, inletDp);
    const requestedJetQ = this.fountainPrimed()
      ? orificeFlow(jetPipe, fountainDp)
      : 0;

    const inVolume = Math.min(
      requestedInQ * dt,
      this.V_A,
      Math.max(0, receiverCapacity - receiverVolume),
    );

    // Leave the water below the active jet-pipe intake in its source chamber.
    const retainedSource = this.sourceConfig().crossSectionArea *
      jetPipe.intakeOffset;
    const jetVolume = Math.min(
      requestedJetQ * dt,
      Math.max(0, sourceVolume - retainedSource),
    );

    if (this.receiverKey() === 'B') this.V_B += inVolume;
    else this.V_C += inVolume;
    if (this.sourceKey() === 'B') this.V_B -= jetVolume;
    else this.V_C -= jetVolume;
    this.V_A += jetVolume - inVolume;

    // A is open: water that cannot fit spills out rather than disappearing or
    // artificially stopping the fountain flow.
    const overflow = Math.max(0, this.V_A - capacityA);
    this.V_A -= overflow;
    this.spilledVolume += overflow;

    const inQ = dt > 0 ? inVolume / dt : 0;
    const jetQ = dt > 0 ? jetVolume / dt : 0;
    const jetV = jetQ > 0 ? Math.sqrt(2 * Math.max(0, fountainDp) / PHYS.rho) : 0;

    const nearEquilibrium =
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
