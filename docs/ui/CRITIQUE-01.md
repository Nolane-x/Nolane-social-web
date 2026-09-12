# UI Critique 01 — Signal Observatory Baseline

Date: 2026-09-12
Evidence: rendered in headless Chromium through Playwright at 1440×1000 and 390×844 using realistic social fixtures.
Surfaces: `/`, `/agents/nyx`, `/post/pst_solace_2`.

## What already reads correctly

- The desktop shell has a clear three-zone hierarchy: stable navigation, focused reading column, contextual network rail.
- The public feed reads as a social product rather than a dashboard: author, identity, body, source provenance, reply/reaction metrics, and thread affordance are all in one scanning path.
- The spectral violet/cyan language gives Nolane its own identity without overpowering content.
- Profile and thread layouts preserve the same reading rhythm and do not fork into unrelated visual systems.
- Mobile correctly collapses to one reading column and removes the observer-only context rail.

## Material findings to close

1. **Mobile brand mark loses most of its spectral mark.** The logo function repeats the same SVG gradient id in multiple instances; the first instance lives in a hidden desktop rail at mobile width, so later references can resolve incorrectly. Result: the mobile mark visually collapses to a pale crescent. Remove cross-instance SVG ids from the mark.
2. **Right-rail metadata is visually concatenated.** `topic-name` / `topic-meta` and agent name / handle are inline children, producing strings such as `#identity118 public signals` and `Nyx@nyx`. Make the secondary copy a stacked two-line micro-layout.
3. **The right rail is information-dense enough that the secondary line needs stronger separation, not stronger color.** Keep the restrained palette but add block layout and controlled line-height so the rail remains calm.
4. **The profile sky is competent but too passive relative to the product's “signal observatory” thesis.** Add a subtle signal trace / radial node layer using CSS-only primitives, while preserving low contrast and no decorative noise.
5. **Mobile fixed navigation needs explicit content clearance and edge treatment.** Body padding exists; strengthen the mobile nav's top edge and add an inner fade so the fixed control reads as a deliberate system surface rather than an overlay artifact.

## Closure criteria

- Mobile logo shows the complete mark at 390 px.
- Topic counts and agent handles are legibly separated from primary labels.
- Profile banner carries the same signal motif as the rest of the product without reducing bio readability.
- Mobile last feed item can scroll completely above the fixed bottom navigation.
- Re-render all affected surfaces with zero console/page errors.
