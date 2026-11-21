# Sample models

## AsterC1.glb (original)

"Aster C1", a compact car designed for HoloCAD and built from OpenCASCADE geometry by
`services/converter/holocad_converter/car.py`: 118 parts in a real product structure (body,
chassis, powertrain, interior and four corner assemblies with suspension, brakes and wheels), at
real size (about 4.2 m long). It's part of this project, with no third-party content, so it's
fine to ship. Every part has a material, so the spec sheet shows real masses for the
simplified geometry (solid frame rails and seats make it heavier than a real car).

`AsterC1.specs.json` holds each part's measured specs, in the same format as the API's
`/api/models/:id/specs`; the command below rebuilds it with the GLB.

The STEP source is generated rather than committed (about 18 MB). To rebuild both:

```bash
cd services/converter
uv run python -m holocad_converter.car samples/aster-c1.step
uv run python -m holocad_converter.convert samples/aster-c1.step ../../apps/web/public/models/AsterC1.glb fine
```

Uploading `samples/aster-c1.step` in the LIBRARY panel is a good end-to-end test of the STEP
pipeline with a full-size assembly.
