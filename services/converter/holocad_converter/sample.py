"""Builds a small gearbox assembly and writes it as STEP.

Used for tests and demos so we don't depend on third-party CAD files. Run:

    uv run python -m holocad_converter.sample out.step
"""

import math
import sys
from pathlib import Path

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.Quantity import Quantity_Color, Quantity_TypeOfColor
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_StepModelType
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TopLoc import TopLoc_Location
from OCP.XCAFDoc import XCAFDoc_ColorType

from .cad_document import color_tool, new_document, shape_tool

# Part names the tests look for.
PART_NAMES = [
    "Base plate",
    "Bearing block",
    "Input shaft",
    "Output shaft",
    "Drive gear",
    "Driven gear",
]
# Bearing block is used twice, so the assembly has one more instance than products.
INSTANCE_COUNT = len(PART_NAMES) + 1


def _box(dx, dy, dz, x=0.0, y=0.0, z=0.0):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def _gear(outer_radius, thickness, teeth, bore_radius):
    """A disc with rectangular notches cut into the rim and a bore through the middle."""
    shape = BRepPrimAPI_MakeCylinder(outer_radius, thickness).Shape()
    notch_depth = outer_radius * 0.18
    notch_width = 2 * math.pi * outer_radius / teeth / 2
    for i in range(teeth):
        notch = _box(
            notch_depth * 2,
            notch_width,
            thickness + 2,
            outer_radius - notch_depth,
            -notch_width / 2,
            -1,
        )
        spin = gp_Trsf()
        spin.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 2 * math.pi * i / teeth)
        shape = BRepAlgoAPI_Cut(shape, notch.Moved(TopLoc_Location(spin))).Shape()
    bore = BRepPrimAPI_MakeCylinder(bore_radius, thickness + 2).Shape().Moved(_placement(z=-1))
    return BRepAlgoAPI_Cut(shape, bore).Shape()


def _placement(x=0.0, y=0.0, z=0.0, axis_along_x=False):
    """Location that optionally turns a Z-axis part to lie along X, then moves it."""
    trsf = gp_Trsf()
    trsf.SetTranslation(gp_Vec(x, y, z))
    if axis_along_x:
        turn = gp_Trsf()
        turn.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), math.pi / 2)
        trsf.Multiply(turn)
    return TopLoc_Location(trsf)


def build_sample_document():
    doc = new_document()
    shapes = shape_tool(doc)
    colors = color_tool(doc)

    def add_part(name, shape, rgb):
        label = shapes.AddShape(shape, False)
        TDataStd_Name.Set_s(label, TCollection_ExtendedString(name))
        color = Quantity_Color(*rgb, Quantity_TypeOfColor.Quantity_TOC_sRGB)
        colors.SetColor(label, color, XCAFDoc_ColorType.XCAFDoc_ColorGen)
        return label

    assembly = shapes.NewShape()
    TDataStd_Name.Set_s(assembly, TCollection_ExtendedString("Mini gearbox"))

    # Millimetres, Z up. Shafts run along X, 36 mm apart so the gears mesh.
    base = add_part("Base plate", _box(140, 80, 8), (0.55, 0.57, 0.6))
    block = add_part("Bearing block", _box(16, 64, 34), (0.3, 0.45, 0.7))
    shaft_in = add_part("Input shaft", BRepPrimAPI_MakeCylinder(5, 130).Shape(), (0.8, 0.8, 0.82))
    shaft_out = add_part("Output shaft", BRepPrimAPI_MakeCylinder(6, 130).Shape(), (0.8, 0.8, 0.82))
    gear_small = add_part("Drive gear", _gear(16, 10, 12, 5), (0.85, 0.6, 0.2))
    gear_large = add_part("Driven gear", _gear(20, 10, 15, 6), (0.75, 0.35, 0.2))

    shapes.AddComponent(assembly, base, _placement(x=-70, y=-40))
    shapes.AddComponent(assembly, block, _placement(x=-58, y=-32, z=8))
    shapes.AddComponent(assembly, block, _placement(x=42, y=-32, z=8))
    shapes.AddComponent(assembly, shaft_in, _placement(x=-65, y=-18, z=30, axis_along_x=True))
    shapes.AddComponent(assembly, shaft_out, _placement(x=-65, y=18, z=30, axis_along_x=True))
    shapes.AddComponent(assembly, gear_small, _placement(x=-5, y=-18, z=30, axis_along_x=True))
    shapes.AddComponent(assembly, gear_large, _placement(x=-5, y=18, z=30, axis_along_x=True))
    shapes.UpdateAssemblies()
    return doc


def write_sample_step(path: Path) -> Path:
    path = Path(path)
    writer = STEPCAFControl_Writer()
    writer.SetNameMode(True)
    writer.SetColorMode(True)
    if not writer.Transfer(build_sample_document(), STEPControl_StepModelType.STEPControl_AsIs):
        raise RuntimeError("Could not transfer the sample assembly to STEP")
    if writer.Write(str(path)) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f"Could not write {path}")
    return path


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "mini-gearbox.step")
    write_sample_step(target)
    print(f"Wrote {target} ({target.stat().st_size / 1024:.0f} KB)")
