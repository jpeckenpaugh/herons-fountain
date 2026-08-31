# Heron's Fountain — 2D Simulation

This project is an interactive, browser-based approximation of a Heron's fountain. It demonstrates how falling water can compress trapped air and use that pressure to drive a fountain jet without a pump.

The simulation favors clear, understandable behavior over complete fluid-dynamics accuracy. It models the important pressure, volume, gravity, and flow relationships while presenting the apparatus as a simple animated side view.

## How it works

The fountain contains three water regions:

- **Basin** — The open vessel at the top. Water drains from here through P1, and the fountain jet returns water here through P3.
- **Chamber A** — The lower compression chamber. Incoming water reduces its air space and compresses the connected air.
- **Chamber B** — The jet reservoir. Shared air pressure pushes its water upward through P3.

The pipes serve different roles:

- **P1** carries water downward from the Basin to Chamber A.
- **P2** connects the air spaces in Chamber A and Chamber B. The model treats these spaces as one shared air volume with one pressure.
- **P3** carries water from Chamber B to the nozzle in the Basin.

At startup, all trapped air is at atmospheric pressure. Gravity causes water to flow through P1 into Chamber A. This reduces the total connected-air volume and raises its pressure. Once the pressure is high enough to lift water from Chamber B to the nozzle, the jet begins.

The fountain eventually stops when its water levels and shared air pressure reach hydrostatic equilibrium, or when the P3 intake becomes exposed.

## Bench-scale apparatus

The modeled apparatus represents a demonstration-sized fountain rather than a building-scale installation:

- Overall height: approximately **0.6 m**
- Basin capacity: **8 L**
- Chamber A capacity: **4 L**
- Chamber B capacity: **4 L**
- P1 and P3 length: **0.25 m** each
- P1 and P3 internal diameter: approximately **7.14 mm**
- P2 air dead volume: **50 mL**
- Manual pour rate: **150 mL/s**

P1 and P3 have the same length, diameter, flow area, and lumped discharge coefficient.

## Physics model

The simulation tracks water as conserved volumes. Water transferred out of one vessel is added to another, while overflow from the open Basin is explicitly recorded as spilled water.

The connected air follows a polytropic pressure-volume relationship:

```text
P = P₀ (V₀ / V)ᵏ
```

The default exponent is `k = 1`, representing isothermal compression. Both sealed chambers therefore share the same absolute air pressure.

Liquid flow through P1 and P3 uses an orifice approximation:

```text
Q = Cd A √(2 ΔP / ρ)
```

where:

- `Q` is volumetric flow rate.
- `Cd` is a lumped discharge coefficient.
- `A` is pipe flow area.
- `ΔP` is the available pressure difference, including hydrostatic head.
- `ρ` is water density.

The displayed P2 pressure is **gauge pressure** relative to the atmosphere. For example, `+2.4 kPa` corresponds to approximately `103.7 kPa` absolute pressure when standard atmospheric pressure is `101.325 kPa`.

## Controls

- Hold **Pour water** to add water to the Basin.
- Hold the **Space bar** as a keyboard alternative.
- Select **Reset** to restore the initial water levels, atmospheric air pressure, and simulation time.

The status line shows elapsed time, jet exit velocity, vessel volumes, fill percentages, and any spilled water.

## Running locally

No build step or external dependency is required. Serve the directory with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in a browser.

## Model boundaries

This is a lumped 2D approximation. It intentionally does not model:

- Detailed turbulence or transient pipe waves
- Individual air bubbles or leaks
- Temperature changes during rapid compression
- Separate pressure dynamics along P2
- Surface tension, viscosity-dependent pipe friction, or nozzle breakup
- Water volume and travel delay inside the pipes

The discharge coefficient approximates several real losses at once. The particle jet is a visualization of the calculated flow and velocity rather than a full free-surface fluid simulation.

## Project structure

- `index.html` defines the page, controls, responsive layout, and labels.
- `physics.js` contains the physical configuration and simulation state updates.
- `render.js` draws the apparatus, animates the jet, and updates the live readouts.
