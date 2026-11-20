# Sample models

## SentinelExosuit.glb (original)

"Sentinel Mk I", an armored exosuit designed for HoloCAD and generated from OpenCASCADE
primitives by `services/converter/holocad_converter/exosuit.py`. It's part of this project, with
no third-party content, so it's fine to ship. The STEP source is
`services/converter/samples/sentinel-exosuit.step`; to rebuild both:

```bash
cd services/converter
uv run python -m holocad_converter.exosuit samples/sentinel-exosuit.step
```

then convert the STEP at FINE quality (upload it in the app, or call
`convert_step_to_glb(..., "fine")`) and copy the result here.

## Khronos samples

These two come from the Khronos glTF Sample Models repository (archived):
https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0

| File | Source folder |
|---|---|
| `2CylinderEngine.glb` | `2.0/2CylinderEngine/glTF-Binary/` |
| `GearboxAssy.glb` | `2.0/GearboxAssy/glTF-Binary/` |

Credit from the source READMEs: "Data conversion from original JT to COLLADA has been kindly
performed by Okino Computer Graphics, using Okino Polytrans Software."

No explicit license file accompanies these two models, and they were not carried over into the
newer glTF-Sample-Assets repository. They're fine for local development and demos; swap in a
model you own before shipping anything public or commercial.
