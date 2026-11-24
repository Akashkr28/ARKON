"""STEP → GLB using OCCT: read with names/colours/assembly, mesh, write glTF."""

import math
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.collections import (
    IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString,
    Sequence_TDF_Label,
)
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.Message import Message_ProgressRange
from OCP.RWGltf import RWGltf_CafWriter
from OCP.RWMesh import RWMesh_CoordinateSystem, RWMesh_NameFormat
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label
from OCP.XCAFDoc import XCAFDoc_ShapeTool

from .cad_document import DOCUMENT_UNIT_IN_METRES, new_document, shape_tool
from .faces import part_faces
from .glb import list_parts
from .occt_messages import configure_occt_output
from .specs import attach_specs, part_specs

configure_occt_output()

STEP_SIGNATURE = b"ISO-10303-21;"
AUTO_INSTANCE_NAME = re.compile(r"^=>\[[\d:]+\]$")


@dataclass(frozen=True)
class Tessellation:
    # Max distance between the true surface and the mesh, as a fraction of the
    # model's bounding-box diagonal, so detail scales with the model's size.
    linear_fraction: float
    # Max angle between adjacent mesh normals, in radians.
    angular: float


QUALITY = {
    "draft": Tessellation(linear_fraction=0.004, angular=0.6),
    "standard": Tessellation(linear_fraction=0.0015, angular=0.4),
    "fine": Tessellation(linear_fraction=0.0005, angular=0.25),
}


class ConversionError(Exception):
    """Something wrong with the input file; the message is meant for the user."""


@dataclass
class ConversionResult:
    output_path: Path
    glb_bytes: int
    part_count: int
    triangle_count: int
    bounds: dict  # metres, glTF axes (Y up)
    parts: list[dict] = field(default_factory=list)
    seconds: float = 0.0

    def to_dict(self) -> dict:
        return {
            "glb_bytes": self.glb_bytes,
            "part_count": self.part_count,
            "triangle_count": self.triangle_count,
            "bounds": self.bounds,
            "parts": self.parts,
            "seconds": round(self.seconds, 2),
        }


def looks_like_step(path: Path) -> bool:
    with open(path, "rb") as f:
        return f.read(64).lstrip().startswith(STEP_SIGNATURE)


def _read_step(path: Path):
    if not looks_like_step(path):
        raise ConversionError(
            "This doesn't look like a STEP file (it should start with ISO-10303-21)."
        )
    doc = new_document()
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    reader.SetColorMode(True)
    reader.SetLayerMode(False)
    reader.SetProductMetaMode(True)  # part numbers and descriptions
    reader.SetMatMode(True)  # materials and densities
    if reader.ReadFile(str(path)) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise ConversionError("The STEP file couldn't be read; it may be damaged or incomplete.")
    if not reader.Transfer(doc, Message_ProgressRange()):
        raise ConversionError("The STEP file contains no geometry that could be imported.")
    return doc


def _label_name(label) -> str | None:
    attr = TDataStd_Name()
    return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attr) else None


def _tidy_instance_names(doc):
    """Give unnamed instances their part's name.

    The STEP reader names an instance "=>[0:1:1:3]" when the file doesn't name it.
    We name GLB nodes instance-first (so "Left arm" and "Right arm" stay distinct),
    which would otherwise put those placeholders in the viewer's labels.
    """
    tool = shape_tool(doc)
    roots = Sequence_TDF_Label()
    tool.GetFreeShapes(roots)
    pending = [roots.Value(i) for i in range(1, roots.Length() + 1)]
    seen = set()
    while pending:
        assembly = pending.pop()
        if assembly.Tag() in seen or not XCAFDoc_ShapeTool.IsAssembly_s(assembly):
            continue
        seen.add(assembly.Tag())
        components = Sequence_TDF_Label()
        XCAFDoc_ShapeTool.GetComponents_s(assembly, components, False)
        for i in range(1, components.Length() + 1):
            component = components.Value(i)
            part = TDF_Label()
            if not XCAFDoc_ShapeTool.GetReferredShape_s(component, part):
                continue
            name = _label_name(component)
            part_name = _label_name(part)
            if part_name and (not name or AUTO_INSTANCE_NAME.match(name)):
                TDataStd_Name.Set_s(component, TCollection_ExtendedString(part_name))
            pending.append(part)


def _top_level_shapes(doc):
    labels = Sequence_TDF_Label()
    shape_tool(doc).GetFreeShapes(labels)
    return [XCAFDoc_ShapeTool.GetShape_s(labels.Value(i)) for i in range(1, labels.Length() + 1)]


def _bounding_box(shapes) -> Bnd_Box:
    box = Bnd_Box()
    for shape in shapes:
        # The "optimal" box is tight; the fast one pads curved surfaces generously.
        BRepBndLib.AddOptimal_s(shape, box, False, False)
    if box.IsVoid():
        raise ConversionError("The STEP file has no solid geometry to display.")
    return box


def _bounds_in_gltf_metres(box: Bnd_Box) -> dict:
    lo, hi = box.CornerMin(), box.CornerMax()

    def metres(value):
        return round(value * DOCUMENT_UNIT_IN_METRES, 6) + 0.0  # + 0.0 turns -0.0 into 0.0

    # CAD is Z-up, glTF is Y-up: (x, y, z) → (x, z, -y).
    return {
        "min": [metres(lo.X()), metres(lo.Z()), metres(-hi.Y())],
        "max": [metres(hi.X()), metres(hi.Z()), metres(-lo.Y())],
        "units": "m",
    }


def _tessellate(shapes, box: Bnd_Box, quality: Tessellation):
    lo, hi = box.CornerMin(), box.CornerMax()
    diagonal = math.dist((lo.X(), lo.Y(), lo.Z()), (hi.X(), hi.Y(), hi.Z()))
    deflection = max(diagonal * quality.linear_fraction, 1e-3)
    for shape in shapes:
        BRepMesh_IncrementalMesh(shape, deflection, False, quality.angular, True)
    return deflection


def _write_glb(doc, path: Path):
    writer = RWGltf_CafWriter(TCollection_AsciiString(str(path)), True)
    axes = writer.ChangeCoordinateSystemConverter()
    axes.SetInputLengthUnit(DOCUMENT_UNIT_IN_METRES)
    axes.SetInputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
    axes.SetOutputLengthUnit(1.0)
    axes.SetOutputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_glTF)
    # Name nodes after the instance when the CAD file names it ("Left arm"), else the
    # part (product) ("Drive gear"); never OCCT's internal labels like "=>[0:1:1:2]".
    writer.SetNodeNameFormat(RWMesh_NameFormat.RWMesh_NameFormat_InstanceOrProduct)
    writer.SetMeshNameFormat(RWMesh_NameFormat.RWMesh_NameFormat_Product)
    # One primitive per part instead of one per B-rep face: the viewer explodes per mesh.
    writer.SetMergeFaces(True)
    writer.SetParallel(True)

    info = IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString()
    info.Add(TCollection_AsciiString("generator"), TCollection_AsciiString("HoloCAD converter"))
    if not writer.Perform(doc, info, Message_ProgressRange()):
        raise RuntimeError("OCCT failed to write the GLB")


def faces_path_for(glb_path: Path) -> Path:
    """Where the face/edge data for a GLB lives: beside it (x.glb → x.faces.json)."""
    return Path(glb_path).with_suffix(".faces.json")


def _write_json_atomically(path: Path, data) -> None:
    import json

    partial = path.with_name(path.name + ".partial")
    try:
        partial.write_text(json.dumps(data, separators=(",", ":")))
        os.replace(partial, path)
    finally:
        partial.unlink(missing_ok=True)


def convert_step_to_glb(
    input_path: Path, output_path: Path, quality: str = "standard"
) -> ConversionResult:
    started = time.perf_counter()
    input_path, output_path = Path(input_path), Path(output_path)
    if quality not in QUALITY:
        raise ValueError(f"Unknown quality {quality!r}; use one of {sorted(QUALITY)}")

    doc = _read_step(input_path)
    _tidy_instance_names(doc)
    shapes = _top_level_shapes(doc)
    box = _bounding_box(shapes)
    deflection = _tessellate(shapes, box, QUALITY[quality])

    # Write to a temp name and rename, so a reader never sees a half-written GLB.
    output_path.parent.mkdir(parents=True, exist_ok=True)
    partial = output_path.with_name(output_path.name + ".partial")
    try:
        _write_glb(doc, partial)
        parts = list_parts(partial)
        if not parts or sum(p["triangle_count"] for p in parts) == 0:
            raise ConversionError("The STEP file produced no visible surfaces after meshing.")
        os.replace(partial, output_path)
    finally:
        partial.unlink(missing_ok=True)
    attach_specs(parts, part_specs(doc))
    faces_path = faces_path_for(output_path)
    _write_json_atomically(faces_path, part_faces(doc, parts, deflection))

    return ConversionResult(
        output_path=output_path,
        glb_bytes=output_path.stat().st_size,
        part_count=len(parts),
        triangle_count=sum(p["triangle_count"] for p in parts),
        bounds=_bounds_in_gltf_metres(box),
        parts=parts,
        seconds=time.perf_counter() - started,
    )


SPEC_UNITS = {
    "length": "mm",
    "area": "mm2",
    "volume": "mm3",
    "mass": "kg",
    "density": "kg/m3",
    "position": "m (viewer axes)",
}


def _camel(value):
    if isinstance(value, list):
        return [_camel(v) for v in value]
    if isinstance(value, dict):
        return {
            re.sub(r"_([a-z0-9])", lambda m: m.group(1).upper(), k): _camel(v)
            for k, v in value.items()
        }
    return value


def specs_document(result: ConversionResult) -> dict:
    """The same JSON the API serves at /api/models/:id/specs (camelCase)."""
    return {
        "units": SPEC_UNITS,
        "parts": [
            {"index": p["index"], "name": p["name"], "spec": _camel(p.get("spec"))}
            for p in result.parts
        ],
    }


def main(argv=None):
    """Convert a STEP file and write its part specs beside it, for models bundled with the app:

    uv run python -m holocad_converter.convert in.step out.glb [draft|standard|fine]
    → out.glb and out.specs.json
    """
    import json
    import sys

    args = sys.argv[1:] if argv is None else argv
    if len(args) not in (2, 3):
        raise SystemExit(main.__doc__)
    result = convert_step_to_glb(
        Path(args[0]), Path(args[1]), args[2] if len(args) == 3 else "standard"
    )
    specs_path = Path(args[1]).with_suffix(".specs.json")
    specs_path.write_text(json.dumps(specs_document(result), separators=(",", ":")))
    print(
        f"{result.part_count} parts, {result.glb_bytes // 1024} KB GLB, specs → {specs_path} ({result.seconds:.1f}s)"
    )


if __name__ == "__main__":
    main()
