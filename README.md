# Heron's Fountain — 2D Simulation

This project is an interactive, browser-based approximation of a Heron's fountain. It demonstrates how falling water can compress trapped air and use that pressure to drive a fountain jet without a pump.

The simulation favors clear, understandable behavior over complete fluid-dynamics accuracy. It models the important pressure, volume, gravity, and flow relationships while presenting the apparatus as a simple animated side view.

## How it works

The fountain contains three water regions:

- **Basin** — The fixed open vessel at the top. It supplies the active drain pipe and receives the fountain jet.
- **Chamber A** — The right sealed chamber, attached to P1.
- **Chamber B** — The left sealed chamber, attached to P3.

The pipes serve different roles:

- **P1** connects the Basin and Chamber A.
- **P2** connects the air spaces in Chamber A and Chamber B. The model treats these spaces as one shared air volume with one pressure.
- **P3** connects Chamber B and the Basin.

In the normal orientation, water drains from the Basin through P1 into lower Chamber A. This compresses the connected air and pushes water from upper Chamber B through P3 to the nozzle. At startup, all trapped air is at atmospheric pressure.

The fountain eventually settles when its water levels and shared air pressure reach hydrostatic equilibrium, or when the active jet pickup becomes exposed.

**Invert** is available at any time. Inverting pauses the physics for one second while Chamber A and P1 move up 10 cm and Chamber B and P3 move down 10 cm. P2 behaves as a flexible tube and remains attached to both chambers. Once the movement finishes, P1 becomes the jet pipe, P3 becomes the drain pipe, and flow resumes in the opposite direction. The next inversion returns the system to its original orientation.

The endpoint labels follow those roles. In the normal orientation, P1's Basin endpoint is the intake and P3's Basin endpoint is the nozzle. After inversion, P3 becomes the intake and P1 becomes the nozzle.

## Bench-scale apparatus

The modeled apparatus represents a demonstration-sized fountain rather than a building-scale installation:

- Overall height: approximately **0.6 m**
- Basin capacity: **8 L**
- Chamber A capacity: **4 L**
- Chamber B capacity: **4 L**
- P1 and P3 length: **0.25 m** each
- P1 and P3 internal diameter: approximately **7.14 mm**
- P2 air dead volume: **50 mL**
- Inversion travel: **0.10 m** per chamber
- Inversion duration: **1 second**

P1 and P3 have the same length, diameter, flow area, and lumped discharge coefficient.

## Physics model

The simulation tracks water as conserved volumes. Water transferred out of one vessel is added to another. During inversion, all volumes, pressure, and simulation time remain fixed.

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

- Select **Invert** at any time to exchange the chamber elevations and reverse the flow. It is disabled only during the transition.
- **Auto Invert** is on by default. Its default trigger inverts after jet speed falls to **0.25 m/s** for **0.5 simulated seconds**, after the jet has first risen above that threshold. This occurs earlier than the nearly stopped condition and preserves a strong following cycle.
- **Trigger** can use jet speed, true jet flow rate, lower receiving-chamber fill, source-chamber fill, elapsed cycle time, or the original settled condition. **Threshold** and **Dwell** configure the selected trigger. Every mode retains the fully settled state as a fallback so the apparatus cannot remain stalled indefinitely.
- **Speed** cycles through **1×**, **2×**, **4×**, **8×**, and **16×** simulation speed. It accelerates physics and jet animation; the inversion transition always lasts one real second.
- Select **Reset** to restore the initial water levels, atmospheric air pressure, and simulation time.
- Hover over or focus a button to see a short explanation. Select **About** for an overview of the apparatus, inversion behavior, and model boundaries.

Reset preserves the selected speed, Auto Invert setting, trigger, threshold, and dwell time.

The status line shows elapsed simulation time, jet exit velocity, true jet flow rate, vessel volumes, and fill percentages.

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
- Detailed valve, sliding-joint, or flexible-tube mechanics during inversion

The discharge coefficient approximates several real losses at once. The particle jet is a visualization of the calculated flow and velocity rather than a full free-surface fluid simulation.

## Project structure

- `index.html` defines the page, controls, responsive layout, and labels.
- `physics.js` contains the physical configuration and simulation state updates.
- `render.js` draws the apparatus, animates the jet, and updates the live readouts.
