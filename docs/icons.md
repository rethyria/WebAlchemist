# Icons

What has to be drawn, at what sizes, and the constraints the drawing has to
satisfy. Drawing the assets is not part of this; specifying them is.

Everything below about Firefox's behaviour was measured against the running
browser, not read from documentation. The method is at the end.

## What exists now

One file, `public/icons/icon.svg`, declared at every size for both the toolbar
and the sidebar. It is a dark rounded square holding a header bar, a light
content block, and an accent block outlined with a dashed stroke.

## What has to be produced

| Asset | Sizes | Declared at | Notes |
|---|---|---|---|
| `icon.svg` | one drawing, authored to read at 16px | source of truth | not shipped as the toolbar icon; see below |
| extension icon | 48, 96 PNG | `manifest.icons` | add-ons manager, about:addons |
| toolbar action | 16, 32 PNG | `action.default_icon` | 32 is the 2× asset for a 16px slot |
| toolbar action, themed | 16, 32 PNG in a light and a dark variant | `action.theme_icons` | four files |
| sidebar | 16, 32 PNG | `sidebar_action.default_icon` | **one variant only** — see the measured finding below |
| AMO listing | 128 PNG | store submission, not the manifest | |

Total: 2 + 2 + 4 + 2 + 1 = eleven raster files, from one drawing.

## Measured findings

### `theme_icons` works on `action` and not on `sidebar_action`

`web-ext lint` accepts `theme_icons` inside `sidebar_action`. It also accepts a
key called `not_a_real_key` inside `sidebar_action`, so its acceptance means
nothing and cannot be used to answer this.

Installing a temporary add-on carrying both keys and reading the manifest
warnings Firefox produced:

```
Reading manifest: Warning processing action.also_not_real: An unexpected property was found…
Reading manifest: Warning processing sidebar_action.theme_icons: An unexpected property was found…
Reading manifest: Warning processing sidebar_action.not_a_real_key: An unexpected property was found…
```

`action.theme_icons` draws no warning. `sidebar_action.theme_icons` draws the
same warning as the invented key.

A second check — whether the key survived manifest normalisation — turned out to
prove nothing, because the invented keys survived it too. The warning is the
only signal. That control is why this section says what it says.

**Consequence for the drawing.** The toolbar mark can have a light and a dark
variant and Firefox will pick. The sidebar mark cannot, so it must be legible
against both a light and a dark sidebar header on its own. In practice that
means the sidebar variant carries its own background — the rounded square the
current mark already has — rather than relying on the surface behind it.

### The mark survives 16px; #40's premise is only half right

#40 says an SVG drawn at 96 "will not hold up" at 16. Rendered to a canvas at
each size and sampled:

| size | distinct colours | blocks still separated | accent still reads as accent |
|---|---|---|---|
| 96 | 50 | yes | yes |
| 32 | 62 | yes | yes |
| 16 | 43 | yes | yes |

The silhouette holds. What does not hold is the detail: the dashed outline is a
3-unit stroke on a 96 grid, which is 0.5px at 16 and disappears, and the gap
between the two blocks stops being background-coloured (`43,45,66` at 96) and
becomes a blend (`74,58,69` at 16) — still darker than either block, so it reads
as a seam rather than an edge.

So raster sizes are still worth producing, but for hinting rather than rescue:
at 16 and 32 the edges can be aligned to the pixel grid instead of landing on
half-pixels.

### The badge is the binding constraint, not the size

#29 puts a badge over the bottom-right corner. Firefox's badge covers roughly
the lower 45% and right 65% of the icon box. Against the current geometry:

| shape | occluded by the badge |
|---|---|
| header bar | 0% |
| content block | 42% |
| accent block | 69% |

The accent block is the one element carrying the idea of a region being
transformed, and it is the element the badge almost entirely covers. Whatever
is drawn, **the distinguishing feature has to live in the top-left**, because
the bottom-right is not reliably visible on the toolbar.

This is the constraint that should drive the redraw. The size was never the
problem.

## Badge states, for reference

From #29, and see the note in `src/background/` about what Firefox permits:

| state | text | colour |
|---|---|---|
| idle | none | — |
| active on this site | count of enabled transforms | accent |
| working | `··` | accent |
| broken | `!` | `#ef8354` |

#29 asks the broken badge to differ in *shape*. Firefox exposes only
`setBadgeText` and `setBadgeBackgroundColor` — an extension cannot shape a
badge. The `!` glyph is the only shape difference available, and it is a glyph,
not a shape. Recorded here so the design is not assumed to have been met.

## Method

- `theme_icons`: a probe add-on at `.probe/` carrying `theme_icons` and an
  invented key in both `action` and `sidebar_action`, installed with
  `AddonManager.installTemporaryAddon` from the parent process over the remote
  debugging protocol, then `ExtensionParent`'s `extension.warnings` read back.
  The invented keys are the control.
- 16px legibility: `icon.svg` drawn to a canvas at 96, 32 and 16 in a content
  page, then `getImageData` sampled at the gap between the blocks and inside
  each block. The 96px render is the control.
- Badge occlusion: geometry, from the shape coordinates in `icon.svg` against
  the badge region. Not a render — Firefox's exact badge box is not queryable,
  so the 45%/65% figure is approximate and the conclusion is drawn from the
  ordering of the numbers rather than their precision.
