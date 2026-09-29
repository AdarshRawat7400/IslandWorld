# EZ-Tree geometry subset

This folder contains the geometry generator from `@dgreenheck/ez-tree` 1.1.0
by Daniel Greenheck, under the MIT license in `LICENSE`.

`tree.js`, `rng.js`, `branch.js`, `enums.js`, `options.js`, and `trellis.js` are
copied from the published package. Relative imports have `.js` extensions so
the files also run as Node ES modules. `textures.js` and `presets.js` are local
shims. The game supplies its own CC0 bark maps and original leaf art, replaces
the generator's temporary materials, and sets all options explicitly. Thus the
published demonstration images and preset JSON are unnecessary at runtime.

The branch and leaf geometry algorithms are unchanged. The focused regression
test compares all 24 game prototypes against the published package numerically.
