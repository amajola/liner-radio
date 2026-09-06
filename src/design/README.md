# Liner Radio — design system

Three files, one rule each.

| File | Holds | Rule |
| --- | --- | --- |
| `tokens.css` | every colour, size, radius, duration and z-index in the product | app CSS references **only** the Tier 2 semantic names |
| `primitives.css` | the component vocabulary (`.btn`, `.surface`, `.callout`, `.chip`, `.avatar`, `.eyebrow`, `.scroll-region`) | composed from tokens, never from literals |
| `../styles.css` | app and feature **layout** | no hex, no font-size, no radius literals |

## Cascade

`src/styles.css` declares the layer order once, on its first line:

```css
@layer tokens, base, primitives, components;
```

`components` is last, so **a feature rule always beats a primitive rule
regardless of specificity**. Overriding a button at one call site needs no
escalated selector and no `!important` — it just needs to live in
`styles.css`. That is the whole cascade strategy.

The build honours this: the emitted stylesheet reorders the blocks to
`tokens → base → primitives → components` and drops the now-redundant
statement. `tests/spa-shell.test.mjs` asserts the declaration is present.

## Tokens: two tiers

**Tier 1 — primitives.** Raw scale values, named for what they *are*:
`--sand-300`, `--space-8`, `--text-lg`, `--lime-400`.

**Tier 2 — semantic roles.** Named for what they *do*: `--color-border`,
`--color-text-muted`, `--color-danger-surface`.

Application CSS uses Tier 2 only. If a component needs a colour that has no
role, **add the role** — don't reach past it to `--sand-500`. That indirection
is what makes a re-theme a one-file change.

The scales:

| Scale | Steps | Notes |
| --- | --- | --- |
| `--sand-*` | 50 → 950 (11) | warm neutral; every surface sits here |
| `--lime-*` | 50 → 900 | the brand accent and its readable olive counterparts |
| `--green/amber/red-*` | fill · border · text | the shape every status surface needs |
| `--space-*` | 0 → 14 | 4px base with a 2px sub-step; this UI is dense |
| `--text-*` | `3xs` (10px) → `3xl` (32px) | 9 steps; plus 3 fluid `--text-display-*` |
| `--radius-*` | `xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `full` | |
| `--control-*` | `xs` 28 → `xl` 48 | **hit targets, not spacing** — kept deliberately separate |
| `--tracking-*` | positive for uppercase labels; `--tracking-display-*` negative for display type | two scales, because the two jobs are unrelated |
| `--shadow-*`, `--duration-*`, `--z-*` | | every `z-index` in the product resolves here |

`--color-live` and `--color-danger` are both red and are deliberately
**separate tokens**: a live indicator and a destructive action must never
share a value, or a palette change to one silently changes the other.

## Primitives

Naming is BEM-ish: `.block`, `.block--variant`, `.is-state`. A button takes
one tone, one size, and any number of shape modifiers:

```html
<button class="btn btn--primary btn--lg">Save</button>
<button class="btn btn--ghost btn--sm btn--icon" aria-label="Close">…</button>
<button class="btn btn--danger btn--block">Delete room</button>
```

**`.btn`** — tones: `--primary` `--accent` `--secondary` `--ghost` `--danger`
`--quiet` `--link` `--bare` `--on-inverse`. Sizes: `--xs` `--sm` (default md)
`--lg` `--xl`. Shapes: `--icon` `--circle` `--block`. State: `.is-busy`
(disabled *because it is working* — gives the wait cursor).

`--icon` takes its width from the size modifier, so it must follow one:
`btn btn--sm btn--icon`.

**`.surface`** — a bordered, rounded container. `--inverse` (the dark entry
card), `--lg` (larger radius), `--dashed` (empty states, drop targets).

**`.callout`** — a short status message on a tinted surface. `--warning`
`--danger` `--danger-soft` `--positive`, plus `--between` for a dismissable
row.

**`.chip`** — compact inline identity or count. `--solid` `--quiet`.

**`.avatar`** — `--xs` `--lg`. **`.eyebrow`** — the uppercase micro-label.

**`.scroll-region`** — the app shell is fixed to the viewport; nothing scrolls
unless it carries this class. That invariant is asserted in
`tests/spa-shell.test.mjs`.

## Adding to the system

- **A one-off difference at a single call site** → a rule in `styles.css`.
  The layer order means it already wins.
- **The same difference in two or more places** → a variant in
  `primitives.css`.
- **A value that isn't on a scale** → add the scale step in `tokens.css`, or
  reconsider whether the design needs a new step at all.

Ship **variants** that have a consumer — the unused ones were removed on the
way in, and adding one back is a single rule. **Scales** are the exception:
`--space-0`, `--space-px`, `--space-13` and `--space-14` have no consumer today
and stay anyway, because a scale that stops at its current high-water mark
stops being a scale.
