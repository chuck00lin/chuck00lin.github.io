# Vendored SuperSplat Viewer

This directory contains the unbundled, self-hosted viewer emitted by
`@playcanvas/splat-transform` 3.3.0. It is used by
`/public/viewer-test/index.html` and has no runtime CDN dependency.

- SuperSplat Viewer: 1.28.0
- Embedded PlayCanvas Engine: 2.20.6 (`9a2a8ef`)
- Generator: `@playcanvas/splat-transform` 3.3.0
- Installed development dependency: `playcanvas` 2.21.4
- License: MIT; see `LICENSE.txt`
- Upstream: https://github.com/playcanvas/supersplat
- Converter: https://github.com/playcanvas/splat-transform

Vendored runtime files:

- `index.js`: viewer and embedded PlayCanvas runtime
- `index.css`: viewer styles
- `LICENSE.txt`: upstream MIT license copied from splat-transform

Rebuild the SOG assets with `scripts/build_row_sog.py`. To refresh the viewer
runtime itself, use the pinned Node.js 24 binary and run the converter's
`--unbundled` export against any SOG, then preserve the customized test page
and settings file separately.
