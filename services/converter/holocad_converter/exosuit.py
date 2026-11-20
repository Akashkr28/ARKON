"""Builds "Sentinel Mk I", an original armored exosuit, as a multi-part STEP assembly.

A showcase model for HoloCAD: ~30 named parts in sub-assemblies (head, torso, left/right
arm, left/right leg) so it explodes well and every label means something. Built from
OCCT primitives; it's our own design, so it can ship with the repo. Run:

    uv run python -m holocad_converter.exosuit out.step
"""

import math
import sys
from pathlib import Path

from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCone,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeSphere,
)
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.Quantity import Quantity_Color, Quantity_TypeOfColor
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_StepModelType
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TopAbs import TopAbs_ShapeEnum
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_ColorType

from .cad_document import color_tool, new_document, shape_tool
from .occt_messages import configure_occt_output

configure_occt_output()

SUIT_NAME = "Sentinel Mk I"

# Gunmetal armor, dark undersuit/joints, teal light strips. (sRGB)
ARMOR = (0.42, 0.45, 0.5)
UNDERSUIT = (0.16, 0.17, 0.2)
LIGHT = (0.1, 0.85, 0.8)

# Millimetres, Z up, feet on Z = 0, the suit faces -Y.


# --- Shape helpers -------------------------------------------------------------


def box(dx, dy, dz, x=0.0, y=0.0, z=0.0):
    """Box centred on (x, y) in plan, sitting on z."""
    return BRepPrimAPI_MakeBox(gp_Pnt(x - dx / 2, y - dy / 2, z), dx, dy, dz).Shape()


def cylinder(radius, height, z=0.0):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, z), gp_Dir(0, 0, 1)), radius, height).Shape()


def cone(bottom_radius, top_radius, height, z=0.0):
    axis = gp_Ax2(gp_Pnt(0, 0, z), gp_Dir(0, 0, 1))
    return BRepPrimAPI_MakeCone(axis, bottom_radius, top_radius, height).Shape()


def sphere(radius, x=0.0, y=0.0, z=0.0):
    return BRepPrimAPI_MakeSphere(gp_Pnt(x, y, z), radius).Shape()


def fillet(shape, radius):
    """Round every edge; falls back to the sharp shape if OCCT can't fillet it."""
    maker = BRepFilletAPI_MakeFillet(shape)
    explorer = TopExp_Explorer(shape, TopAbs_ShapeEnum.TopAbs_EDGE)
    while explorer.More():
        maker.Add(radius, TopoDS.Edge(explorer.Current()))
        explorer.Next()
    try:
        maker.Build()
        return maker.Shape() if maker.IsDone() else shape
    except Exception:  # OCCT raises Standard_Failure for impossible fillets
        return shape


def cut(a, b):
    return BRepAlgoAPI_Cut(a, b).Shape()


def fuse(a, b):
    return BRepAlgoAPI_Fuse(a, b).Shape()


def common(a, b):
    return BRepAlgoAPI_Common(a, b).Shape()


def hex_plate(radius, thickness):
    """Hexagonal prism lying in the XZ plane, facing -Y."""
    polygon = BRepBuilderAPI_MakePolygon()
    for i in range(6):
        angle = math.pi / 6 + i * math.pi / 3
        polygon.Add(gp_Pnt(radius * math.cos(angle), 0, radius * math.sin(angle)))
    polygon.Close()
    face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face()
    return BRepPrimAPI_MakePrism(face, gp_Vec(0, -thickness, 0)).Shape()


def at(x=0.0, y=0.0, z=0.0):
    trsf = gp_Trsf()
    trsf.SetTranslation(gp_Vec(x, y, z))
    return TopLoc_Location(trsf)


# --- Parts -------------------------------------------------------------------------


def helmet():
    shell = cut(sphere(115, z=1665), box(400, 400, 200, z=1370))  # flat underside at z 1570
    jaw = fillet(box(150, 120, 70, y=-40, z=1575), 25)
    return fuse(shell, jaw)


def visor():
    # A band of a slightly larger sphere, only across the front at eye height.
    band = cut(sphere(121, z=1665), sphere(112, z=1665))
    window = box(220, 120, 34, y=-100, z=1655)
    return common(band, window)


def neck_ring():
    return cut(cylinder(68, 45, z=1520), cylinder(50, 60, z=1510))


def chest_plate():
    return fillet(box(400, 210, 340, z=1160), 45)


def chest_core():
    return hex_plate(42, 18)


def abdomen_segment():
    return fillet(box(290, 170, 40), 15)


def hip_plate():
    return fillet(box(340, 190, 120, z=880), 30)


def back_module():
    return fillet(box(300, 110, 300, y=160, z=1180), 30)


def thruster():
    body = cylinder(34, 70)
    nozzle = cut(cone(30, 42, 40, z=-40), cone(22, 36, 42, z=-41))
    return fuse(body, nozzle)


# Arm parts in arm-local coordinates: hand at the bottom (z = 0), shoulder at the top.
def gauntlet():
    return fillet(box(92, 76, 115), 22)


def forearm():
    return cone(52, 58, 260, z=125)


def forearm_light():
    # A thin strip on the outer-front of the forearm.
    strip = box(14, 8, 180, y=-57, z=165)
    return common(strip, cylinder(62, 400, z=100))


def elbow_joint():
    return sphere(50, z=405)


def upper_arm():
    return cylinder(56, 270, z=430)


def shoulder_plate():
    dome = cut(sphere(98, z=720), box(400, 400, 200, z=520))  # keep the top half
    return fuse(dome, cylinder(98, 18, z=702))


# Leg parts in leg-local coordinates: sole at z = 0, hip at the top.
def boot():
    return fillet(box(125, 265, 85, y=-40), 30)


def shin_guard():
    return cone(58, 72, 380, z=85)


def knee_guard():
    return cut(sphere(58, y=-30, z=482), box(300, 300, 200, y=150, z=380))


def thigh_plate():
    return cylinder(82, 390, z=490)


# --- Assembly ----------------------------------------------------------------------


def build_exosuit_document():
    doc = new_document()
    shapes = shape_tool(doc)
    colors = color_tool(doc)

    def name(label, text):
        TDataStd_Name.Set_s(label, TCollection_ExtendedString(text))

    def part(text, shape, rgb):
        label = shapes.AddShape(shape, False)
        name(label, text)
        colors.SetColor(label, Quantity_Color(*rgb, Quantity_TypeOfColor.Quantity_TOC_sRGB), XCAFDoc_ColorType.XCAFDoc_ColorGen)
        return label

    def assembly(text):
        label = shapes.NewShape()
        name(label, text)
        return label

    def place(parent, child, location, instance_name=None):
        component = shapes.AddComponent(parent, child, location)
        if instance_name:
            name(component, instance_name)
        return component

    suit = assembly(SUIT_NAME)

    head = assembly("Head")
    place(head, part("Helmet", helmet(), ARMOR), at())
    place(head, part("Visor", visor(), LIGHT), at())
    place(head, part("Neck ring", neck_ring(), UNDERSUIT), at())
    place(suit, head, at())

    torso = assembly("Torso")
    place(torso, part("Chest plate", chest_plate(), ARMOR), at())
    place(torso, part("Chest core", chest_core(), LIGHT), at(y=-105, z=1390))
    segment = part("Abdomen segment", abdomen_segment(), UNDERSUIT)
    for i, z in enumerate((1010, 1060, 1110)):
        place(torso, segment, at(z=z), f"Abdomen segment {i + 1}")
    place(torso, part("Hip plate", hip_plate(), ARMOR), at())
    place(torso, part("Back module", back_module(), ARMOR), at())
    jet = part("Thruster", thruster(), UNDERSUIT)
    place(torso, jet, at(x=-80, y=165, z=1110), "Left thruster")
    place(torso, jet, at(x=80, y=165, z=1110), "Right thruster")
    place(suit, torso, at())

    # One arm and one leg design, placed on both sides.
    arm = assembly("Arm")
    place(arm, part("Gauntlet", gauntlet(), ARMOR), at())
    place(arm, part("Forearm", forearm(), ARMOR), at())
    place(arm, part("Forearm light", forearm_light(), LIGHT), at())
    place(arm, part("Elbow joint", elbow_joint(), UNDERSUIT), at())
    place(arm, part("Upper arm", upper_arm(), ARMOR), at())
    place(arm, part("Shoulder plate", shoulder_plate(), ARMOR), at())
    place(suit, arm, at(x=-262, z=760), "Left arm")
    place(suit, arm, at(x=262, z=760), "Right arm")

    leg = assembly("Leg")
    place(leg, part("Boot", boot(), UNDERSUIT), at())
    place(leg, part("Shin guard", shin_guard(), ARMOR), at())
    place(leg, part("Knee guard", knee_guard(), ARMOR), at())
    place(leg, part("Thigh plate", thigh_plate(), ARMOR), at())
    place(suit, leg, at(x=-108), "Left leg")
    place(suit, leg, at(x=108), "Right leg")

    shapes.UpdateAssemblies()
    return doc


def write_exosuit_step(path: Path) -> Path:
    path = Path(path)
    writer = STEPCAFControl_Writer()
    writer.SetNameMode(True)
    writer.SetColorMode(True)
    if not writer.Transfer(build_exosuit_document(), STEPControl_StepModelType.STEPControl_AsIs):
        raise RuntimeError("Could not transfer the exosuit to STEP")
    if writer.Write(str(path)) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f"Could not write {path}")
    return path


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "sentinel-exosuit.step")
    write_exosuit_step(target)
    print(f"Wrote {target} ({target.stat().st_size / 1024:.0f} KB)")
