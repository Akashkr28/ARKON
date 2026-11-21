"""Builds "Aster C1", an original compact car, as a multi-level STEP assembly.

The reference model for HoloCAD: ~110 named parts in a realistic product structure
(body panels and glass, chassis, powertrain, interior, and four corner assemblies,
each with suspension, brakes and a wheel). Real dimensions in millimetres: about
4.2 m long, 1.8 m wide, 1.45 m tall, 2.6 m wheelbase. Our own design, so it can ship
with the repo. Run:

    uv run python -m holocad_converter.car out.step

Axes (CAD convention): X = right, Y = backward (the car faces -Y), Z = up, ground at Z = 0.
"""

import math
import sys
from pathlib import Path

from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_Copy,
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_MakeWire,
)
from OCP.GeomAPI import GeomAPI_Interpolate
from OCP.collections import HArray1_gp_Pnt
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCone,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeSphere,
    BRepPrimAPI_MakeTorus,
)
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
from OCP.IFSelect import IFSelect_ReturnStatus
from OCP.Quantity import Quantity_Color, Quantity_ColorRGBA, Quantity_TypeOfColor
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_StepModelType
from OCP.TCollection import TCollection_ExtendedString, TCollection_HAsciiString
from OCP.TDataStd import TDataStd_Name
from OCP.TopAbs import TopAbs_ShapeEnum
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_ColorType, XCAFDoc_DocumentTool

from .cad_document import color_tool, new_document, shape_tool
from .occt_messages import configure_occt_output

configure_occt_output()

CAR_NAME = "Aster C1"

# Main dimensions (mm).
WHEELBASE = 2600
TRACK = 1550
WHEEL_RADIUS = 320
FRONT_AXLE_Y = -WHEELBASE / 2
REAR_AXLE_Y = WHEELBASE / 2

# Colours: (r, g, b) or (r, g, b, alpha), sRGB.
PAINT = (0.11, 0.2, 0.38)
GLASS = (0.16, 0.22, 0.27, 0.35)
HEADLIGHT = (0.9, 0.92, 0.95, 0.6)
TAILLIGHT = (0.62, 0.05, 0.05, 0.85)
BLACK_PLASTIC = (0.07, 0.07, 0.08)
TYRE = (0.05, 0.05, 0.05)
ALLOY = (0.72, 0.74, 0.77)
STEEL = (0.45, 0.46, 0.48)
CAST_IRON = (0.33, 0.34, 0.35)
CALIPER = (0.7, 0.1, 0.08)
ENGINE = (0.42, 0.43, 0.45)
INTERIOR = (0.14, 0.14, 0.16)
CHASSIS = (0.12, 0.12, 0.13)
SPRING = (0.75, 0.55, 0.1)
UNDERBODY = (0.13, 0.13, 0.14)  # floor pan: part of the body shell, not the steel frame

# Material per finish: (name, density in g/cm³). The model is simplified (solid seats,
# 40 mm body shells), so the body uses a light sandwich panel to keep masses plausible.
MATERIALS = {
    PAINT: ("Composite sandwich panel", 0.15),
    GLASS: ("Polycarbonate glazing", 1.2),
    HEADLIGHT: ("Polycarbonate", 1.2),
    TAILLIGHT: ("Polycarbonate", 1.2),
    BLACK_PLASTIC: ("ABS", 1.05),
    TYRE: ("Rubber compound", 1.15),
    ALLOY: ("Aluminium 6061-T6", 2.7),
    STEEL: ("Steel AISI 1045", 7.85),
    CAST_IRON: ("Grey cast iron", 7.2),
    CALIPER: ("Grey cast iron", 7.2),
    ENGINE: ("Aluminium A356 cast", 2.68),
    INTERIOR: ("Polyurethane foam", 0.06),
    CHASSIS: ("Steel S355", 7.85),
    UNDERBODY: ("Composite sandwich panel", 0.15),
    SPRING: ("Spring steel 55SiCr", 7.85),
}

BIG = 5000.0


# --- Shape helpers -------------------------------------------------------------------


def box(x0, x1, y0, y1, z0, z1):
    return BRepPrimAPI_MakeBox(gp_Pnt(x0, y0, z0), x1 - x0, y1 - y0, z1 - z0).Shape()


def cylinder(radius, length, origin=(0, 0, 0), axis=(0, 0, 1)):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*origin), gp_Dir(*axis)), radius, length).Shape()


def cone(r1, r2, length, origin=(0, 0, 0), axis=(0, 0, 1)):
    return BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(*origin), gp_Dir(*axis)), r1, r2, length).Shape()


def sphere(radius, centre=(0, 0, 0)):
    return BRepPrimAPI_MakeSphere(gp_Pnt(*centre), radius).Shape()


def torus(major, minor, centre=(0, 0, 0), axis=(0, 0, 1)):
    return BRepPrimAPI_MakeTorus(gp_Ax2(gp_Pnt(*centre), gp_Dir(*axis)), major, minor).Shape()


def cut(a, *others):
    for b in others:
        a = BRepAlgoAPI_Cut(a, b).Shape()
    return a


def fuse(a, *others):
    for b in others:
        a = BRepAlgoAPI_Fuse(a, b).Shape()
    return a


def common(a, b):
    return BRepAlgoAPI_Common(a, b).Shape()


def fillet(shape, radius):
    """Round every edge; keep the sharp shape if OCCT can't."""
    maker = BRepFilletAPI_MakeFillet(shape)
    explorer = TopExp_Explorer(shape, TopAbs_ShapeEnum.TopAbs_EDGE)
    while explorer.More():
        maker.Add(radius, TopoDS.Edge(explorer.Current()))
        explorer.Next()
    try:
        maker.Build()
        return maker.Shape() if maker.IsDone() else shape
    except Exception:  # Standard_Failure for impossible fillets
        return shape


def moved(shape, x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0):
    return shape.Moved(placement(x, y, z, rx, ry, rz))


def placement(x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0):
    """Rotate about X, then Y, then Z (degrees), then translate."""
    trsf = gp_Trsf()
    trsf.SetTranslation(gp_Vec(x, y, z))
    for axis, angle in ((gp_Dir(0, 0, 1), rz), (gp_Dir(0, 1, 0), ry), (gp_Dir(1, 0, 0), rx)):
        if angle:
            turn = gp_Trsf()
            turn.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), axis), math.radians(angle))
            trsf.Multiply(turn)
    return TopLoc_Location(trsf)


def hex_prism(radius, height, origin=(0, 0, 0)):
    polygon = BRepBuilderAPI_MakePolygon()
    for i in range(6):
        a = math.pi / 6 + i * math.pi / 3
        polygon.Add(gp_Pnt(origin[0] + radius * math.cos(a), origin[1] + radius * math.sin(a), origin[2]))
    polygon.Close()
    face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face()
    return BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, height)).Shape()


# --- Body -------------------------------------------------------------------------------
# The body is lofted through rounded cross-sections (superellipses) along the car's
# length, hollowed into a shell, then split into panels like a real body-in-white.

# (y, half width, bottom z, top z)
LOWER_SECTIONS = [
    (-2110, 750, 340, 650),
    (-1980, 855, 270, 785),
    (-1600, 895, 235, 840),
    (-900, 900, 215, 880),
    (0, 900, 205, 895),
    (900, 900, 215, 905),
    (1600, 895, 235, 900),
    (1980, 860, 275, 880),
    (2110, 775, 345, 815),
]
CABIN_SECTIONS = [
    (-920, 770, 820, 895),
    (-260, 735, 820, 1420),
    (760, 725, 820, 1430),
    (1360, 745, 820, 960),
]
SHELL = 40  # panel thickness used to hollow the body (thick, so it reads well when cut)


def _section_wire(y, half_width, z_bottom, z_top, roundness, points=16):
    """One smooth closed spline through a superellipse (a rounded rectangle).

    A single curve per section keeps the lofted surface to a few patches, which keeps
    the boolean splits fast and the STEP file small (a polygon made it ~40 MB).
    """
    zc, half_height = (z_bottom + z_top) / 2, (z_top - z_bottom) / 2
    samples = HArray1_gp_Pnt(1, points)
    for i in range(points):
        t = 2 * math.pi * i / points
        c, s = math.cos(t), math.sin(t)
        x = half_width * math.copysign(abs(c) ** (2 / roundness), c)
        z = zc + half_height * math.copysign(abs(s) ** (2 / roundness), s)
        samples.SetValue(i + 1, gp_Pnt(x, y, z))
    spline = GeomAPI_Interpolate(samples, True, 1e-6)  # periodic: closes smoothly
    spline.Perform()
    edge = BRepBuilderAPI_MakeEdge(spline.Curve()).Edge()
    return BRepBuilderAPI_MakeWire(edge).Wire()


def _loft(sections, roundness):
    # Ruled (straight between sections): ~15× faster to hollow and split than a smooth
    # loft, and the sections are close enough together that it still reads as curved.
    maker = BRepOffsetAPI_ThruSections(True, True)
    for section in sections:
        maker.AddWire(_section_wire(*section, roundness))
    maker.Build()
    return maker.Shape()


def _shrunk(sections, inset):
    """The same sections, pulled in by `inset` on every side (for the hollow inside)."""
    shrunk = []
    last = len(sections) - 1
    for i, (y, hw, zb, zt) in enumerate(sections):
        y = y + inset if i == 0 else y - inset if i == last else y
        bottom, top = zb + inset, max(zb + inset + 10, zt - inset)
        shrunk.append((y, hw - inset, bottom, top))
    return shrunk


def wheel_arches():
    arches = []
    for y in (FRONT_AXLE_Y, REAR_AXLE_Y):
        arches.append(cylinder(WHEEL_RADIUS + 55, 2 * BIG, origin=(-BIG, y, WHEEL_RADIUS), axis=(1, 0, 0)))
    return arches


def body_volumes():
    outer = fuse(_loft(LOWER_SECTIONS, 6), _loft(CABIN_SECTIONS, 4))
    inner = fuse(_loft(_shrunk(LOWER_SECTIONS, SHELL), 6), _loft(_shrunk(CABIN_SECTIONS, SHELL), 4))
    # Hollow first, then open the wheel arches: the other way round, the inner volume
    # pokes through the arches and the boolean gets ~10× slower.
    shell = cut(cut(outer, inner), *wheel_arches())
    outer = cut(outer, *wheel_arches())
    return outer, shell


def left(x0, x1):
    """x range mirrored to the left side (the car faces -Y, so left is -X)."""
    return -x1, -x0


# (name, colour, region box, side). Regions are taken in order; whatever remains of the
# shell at the end becomes "Pillars and roof rails".
def body_regions():
    return [
        # Openings filled with their own parts.
        ("Windshield", GLASS, box(-700, 700, -900, -270, 905, 1400)),
        ("Rear window", GLASS, box(-680, 680, 770, 1340, 910, 1400)),
        ("Left front window", GLASS, box(-BIG, -600, -230, 300, 930, 1360)),
        ("Right front window", GLASS, box(600, BIG, -230, 300, 930, 1360)),
        ("Left rear window", GLASS, box(-BIG, -600, 360, 720, 930, 1360)),
        ("Right rear window", GLASS, box(600, BIG, 360, 720, 930, 1360)),
        # Panels.
        ("Front bumper", BLACK_PLASTIC, box(-BIG, BIG, -BIG, -1880, 0, 820)),
        ("Rear bumper", BLACK_PLASTIC, box(-BIG, BIG, 1920, BIG, 0, 840)),
        ("Floor pan", UNDERBODY, box(-BIG, BIG, -1880, 1920, 0, 320)),
        ("Hood", PAINT, box(-BIG, BIG, -1880, -900, 760, BIG)),
        ("Trunk lid", PAINT, box(-BIG, BIG, 1380, 1920, 860, BIG)),
        ("Roof panel", PAINT, box(-BIG, BIG, -270, 770, 1340, BIG)),
        ("Left front fender", PAINT, box(-BIG, 0, -1880, -700, 320, 760)),
        ("Right front fender", PAINT, box(0, BIG, -1880, -700, 320, 760)),
        ("Left front door", PAINT, box(-BIG, 0, -700, 250, 320, 940)),
        ("Right front door", PAINT, box(0, BIG, -700, 250, 320, 940)),
        ("Left rear door", PAINT, box(-BIG, 0, 250, 950, 320, 940)),
        ("Right rear door", PAINT, box(0, BIG, 250, 950, 320, 940)),
        ("Left rear quarter panel", PAINT, box(-BIG, 0, 950, 1920, 320, 940)),
        ("Right rear quarter panel", PAINT, box(0, BIG, 950, 1920, 320, 940)),
    ]


def lamp_parts(outer):
    """Lamps and grille: solid pieces of the outer body volume at the front and rear."""
    return [
        ("Left headlight", HEADLIGHT, common(outer, box(-890, -480, -BIG, -1955, 600, 760))),
        ("Right headlight", HEADLIGHT, common(outer, box(480, 890, -BIG, -1955, 600, 760))),
        ("Grille", BLACK_PLASTIC, common(outer, box(-400, 400, -BIG, -1990, 430, 620))),
        ("Left taillight", TAILLIGHT, common(outer, box(-890, -520, 1985, BIG, 640, 800))),
        ("Right taillight", TAILLIGHT, common(outer, box(520, 890, 1985, BIG, 640, 800))),
    ]


def body_parts():
    outer, shell = body_volumes()
    lamps = lamp_parts(outer)
    for _, _, lamp in lamps:
        shell = cut(shell, lamp)
    parts = []
    for name, colour, region in body_regions():
        piece = common(shell, region)
        shell = cut(shell, region)
        parts.append((name, colour, piece))
    parts.append(("Pillars and roof rails", PAINT, shell))
    parts.extend(lamps)
    return parts


def door_mirror():
    return fillet(box(-60, 60, -60, 60, -45, 45), 20)


# --- Corner: suspension, brake and wheel -----------------------------------------------------
# Built for the right-hand side in local coordinates (origin = wheel centre, outboard = +X);
# the left corners are the same assembly turned 180° about Z.


def wheel_parts():
    """Rim, tyre, centre cap, 5 lug nuts. Axis along Z here; turned to X when placed."""
    tyre = fillet(cut(cylinder(WHEEL_RADIUS, 205, origin=(0, 0, -102.5)), cylinder(216, 300, origin=(0, 0, -150))), 45)
    barrel = cut(cylinder(216, 190, origin=(0, 0, -95)), cylinder(200, 300, origin=(0, 0, -150)))
    face = cylinder(216, 24, origin=(0, 0, 70))
    for i in range(5):
        a = 2 * math.pi * i / 5 + math.pi / 5
        face = cut(face, cylinder(52, 60, origin=(130 * math.cos(a), 130 * math.sin(a), 50)))
    face = cut(face, cylinder(34, 60, origin=(0, 0, 50)))
    rim = fuse(barrel, face)
    cap = fillet(cylinder(32, 10, origin=(0, 0, 92)), 4)
    # One lug nut on the bolt circle; the wheel assembly places it five times.
    nut = hex_prism(11, 16, origin=(60, 0, 94))
    return rim, tyre, cap, nut


def corner_parts():
    to_x = dict(ry=90)  # local Z axis → X (outboard)
    disc = moved(cut(cylinder(160, 26, origin=(0, 0, -13)), cylinder(60, 60, origin=(0, 0, -30))), x=-35, **to_x)
    caliper = fillet(box(-70, -10, 40, 150, 70, 170), 18)
    hub = cylinder(70, 70, origin=(-110, 0, 0), axis=(1, 0, 0))
    knuckle = fillet(box(-190, -110, -70, 70, -110, 150), 15)
    damper = fuse(cylinder(26, 280, origin=(-160, 0, 150)), cylinder(14, 220, origin=(-160, 0, 420)))
    # Coils as flat rings: reads as a spring, at a fraction of the triangles of a helix or tori.
    coil = cut(cylinder(70, 14, origin=(-160, 0, 0)), cylinder(54, 30, origin=(-160, 0, -8)))
    spring = fuse(*[moved(coil, z=213 + 38 * i) for i in range(7)])
    arm = fillet(box(-560, -150, -140, 140, -90, -55), 12)
    return [
        ("Brake disc", CAST_IRON, disc),
        ("Brake caliper", CALIPER, caliper),
        ("Wheel hub", STEEL, hub),
        ("Steering knuckle", STEEL, knuckle),
        ("Damper", STEEL, damper),
        ("Coil spring", SPRING, spring),
        ("Lower control arm", CHASSIS, arm),
    ]


# --- Chassis, powertrain, interior (global coordinates) ------------------------------------


def frame_rail():
    return fillet(box(-40, 40, -1750, 1900, 250, 360), 10)


def chassis_parts():
    return [
        ("Front subframe", CHASSIS, fillet(box(-560, 560, -1560, -1100, 245, 300), 10)),
        ("Rear axle beam", CHASSIS, cylinder(42, 1300, origin=(-650, REAR_AXLE_Y - 60, 300), axis=(1, 0, 0))),
        ("Front crossmember", CHASSIS, fillet(box(-650, 650, -1850, -1780, 300, 420), 10)),
    ]


def powertrain_parts():
    block = box(-340, 180, -1600, -1240, 360, 700)
    for i in range(4):  # four cylinder bores, visible in a section cut
        block = cut(block, cylinder(40, 300, origin=(-260 + i * 120, -1420, 450)))
    head = fillet(box(-340, 180, -1590, -1250, 700, 780), 12)
    valve_cover = fillet(box(-320, 160, -1560, -1280, 780, 815), 15)
    oil_pan = fillet(box(-320, 160, -1560, -1280, 300, 360), 12)
    intake = fuse(*[cylinder(22, 160, origin=(-260 + i * 120, -1250, 690), axis=(0, 1, 0)) for i in range(4)],
                  cylinder(45, 520, origin=(-340, -1090, 690), axis=(1, 0, 0)))
    exhaust = fuse(*[cylinder(20, 120, origin=(-260 + i * 120, -1720, 620), axis=(0, 1, 0)) for i in range(4)],
                   cylinder(35, 480, origin=(-320, -1720, 620), axis=(1, 0, 0)))
    bell = cone(210, 170, 120, origin=(180, -1420, 520), axis=(1, 0, 0))
    gearbox = fuse(bell, fillet(box(300, 560, -1540, -1300, 360, 640), 25))
    left_shaft = cylinder(22, 520, origin=(-TRACK / 2 + 200, FRONT_AXLE_Y, WHEEL_RADIUS), axis=(1, 0, 0))
    right_shaft = cylinder(22, TRACK / 2 - 200 - 560, origin=(560, FRONT_AXLE_Y, WHEEL_RADIUS), axis=(1, 0, 0))
    pipe = cylinder(28, 3300, origin=(250, -1650, 205), axis=(0, 1, 0))
    muffler = fillet(box(130, 470, 1500, 1860, 150, 270), 40)
    return [
        ("Engine block", ENGINE, block),
        ("Cylinder head", ENGINE, head),
        ("Valve cover", BLACK_PLASTIC, valve_cover),
        ("Oil pan", CAST_IRON, oil_pan),
        ("Intake manifold", BLACK_PLASTIC, intake),
        ("Exhaust manifold", CAST_IRON, exhaust),
        ("Gearbox", ENGINE, gearbox),
        ("Left drive shaft", STEEL, left_shaft),
        ("Right drive shaft", STEEL, right_shaft),
        ("Radiator", ALLOY, box(-360, 360, -1830, -1790, 380, 760)),
        ("Battery", BLACK_PLASTIC, fillet(box(-620, -380, -1180, -1010, 450, 640), 8)),
        ("Exhaust pipe", STEEL, pipe),
        ("Muffler", STEEL, muffler),
        ("Fuel tank", BLACK_PLASTIC, fillet(box(-380, 380, 1060, 1380, 260, 470), 30)),
    ]


def front_seat():
    cushion = fillet(box(-250, 250, -260, 260, 290, 410), 35)
    backrest = moved(fillet(box(-250, 250, -55, 55, 0, 620), 35), y=290, z=380, rx=-15)
    headrest = moved(fillet(box(-130, 130, -45, 45, 0, 170), 30), y=470, z=1000, rx=-15)
    return fuse(cushion, backrest, headrest)


def interior_parts():
    bench = fuse(
        fillet(box(-640, 640, 430, 930, 300, 420), 40),
        moved(fillet(box(-640, 640, -55, 55, 0, 560), 35), y=960, z=400, rx=-18),
    )
    column = moved(cylinder(25, 420), x=-380, y=-640, z=780, rx=70)
    wheel = moved(fuse(torus(185, 16), cylinder(45, 40, origin=(0, 0, -20))), x=-380, y=-320, z=900, rx=70)
    pedals = [
        (f"{name} pedal", STEEL, moved(fillet(box(-35, 35, -8, 8, 0, 110), 4), x=x, y=-600, z=300, rx=20))
        for name, x in (("Clutch", -500), ("Brake", -400), ("Accelerator", -300))
    ]
    return [
        ("Dashboard", INTERIOR, fillet(box(-760, 760, -740, -470, 690, 930), 60)),
        ("Steering column", STEEL, column),
        ("Steering wheel", INTERIOR, wheel),
        ("Centre console", INTERIOR, fillet(box(-110, 110, -520, 250, 245, 500), 30)),
        ("Gear lever", INTERIOR, fuse(cylinder(10, 140, origin=(0, -360, 500)), sphere(28, (0, -360, 650)))),
        ("Rear bench", INTERIOR, bench),
        *pedals,
    ]


# --- Assembly --------------------------------------------------------------------------------


def build_car_document():
    doc = new_document()
    shapes = shape_tool(doc)
    colors = color_tool(doc)
    material_tool = XCAFDoc_DocumentTool.MaterialTool_s(doc.Main())
    material_labels = {}

    def material(label, rgba):
        text, density = MATERIALS[rgba]
        if text not in material_labels:
            material_labels[text] = material_tool.AddMaterial(
                TCollection_HAsciiString(text),
                TCollection_HAsciiString(""),
                density,
                TCollection_HAsciiString("density"),
                TCollection_HAsciiString("POSITIVE_RATIO_MEASURE"),
            )
        material_tool.SetMaterial(label, material_labels[text])

    def name(label, text):
        TDataStd_Name.Set_s(label, TCollection_ExtendedString(text))

    def colour(label, rgba):
        rgb = Quantity_Color(*rgba[:3], Quantity_TypeOfColor.Quantity_TOC_sRGB)
        value = Quantity_ColorRGBA(rgb, rgba[3]) if len(rgba) == 4 else rgb
        colors.SetColor(label, value, XCAFDoc_ColorType.XCAFDoc_ColorGen)

    def part(text, shape, rgba):
        # A copy, so two parts built from the same shape stay two distinct parts.
        label = shapes.AddShape(BRepBuilderAPI_Copy(shape).Shape(), False)
        name(label, text)
        colour(label, rgba)
        material(label, rgba)
        return label

    def assembly(text):
        label = shapes.NewShape()
        name(label, text)
        return label

    def place(parent, child, location=None, instance_name=None):
        component = shapes.AddComponent(parent, child, location or TopLoc_Location())
        if instance_name:
            name(component, instance_name)

    def group(parent, title, parts):
        sub = assembly(title)
        for text, rgba, shape in parts:
            place(sub, part(text, shape, rgba))
        place(parent, sub)

    car = assembly(CAR_NAME)

    body = assembly("Body")
    for text, rgba, shape in body_parts():
        place(body, part(text, shape, rgba))
    mirror = part("Door mirror", door_mirror(), PAINT)
    place(body, mirror, placement(x=-935, y=-640, z=985), "Left mirror")
    place(body, mirror, placement(x=935, y=-640, z=985), "Right mirror")
    place(car, body)

    chassis = assembly("Chassis")
    rail = part("Frame rail", frame_rail(), CHASSIS)
    place(chassis, rail, placement(x=-610), "Left frame rail")
    place(chassis, rail, placement(x=610), "Right frame rail")
    for text, rgba, shape in chassis_parts():
        place(chassis, part(text, shape, rgba))
    place(car, chassis)
    group(car, "Powertrain", powertrain_parts())

    interior = assembly("Interior")
    seat = part("Front seat", front_seat(), INTERIOR)
    place(interior, seat, placement(x=-380, y=-120), "Driver seat")
    place(interior, seat, placement(x=380, y=-120), "Passenger seat")
    for text, rgba, shape in interior_parts():
        place(interior, part(text, shape, rgba))
    place(car, interior)

    # One wheel design and one corner design, each placed four times.
    wheel = assembly("Wheel")
    rim, tyre, cap, nut_shape = wheel_parts()
    to_x = placement(ry=90)
    place(wheel, part("Rim", rim, ALLOY), to_x)
    place(wheel, part("Tyre", tyre, TYRE), to_x)
    place(wheel, part("Centre cap", cap, BLACK_PLASTIC), to_x)
    nut = part("Lug nut", nut_shape, STEEL)
    for i in range(5):
        a = 360 * i / 5
        place(wheel, nut, _nut_location(a), f"Lug nut {i + 1}")

    corner = assembly("Corner")
    for text, rgba, shape in corner_parts():
        place(corner, part(text, shape, rgba))
    place(corner, wheel, None, "Wheel")

    half_track = TRACK / 2
    for label, x, y, turn in (
        ("Front left corner", -half_track, FRONT_AXLE_Y, 180),
        ("Front right corner", half_track, FRONT_AXLE_Y, 0),
        ("Rear left corner", -half_track, REAR_AXLE_Y, 180),
        ("Rear right corner", half_track, REAR_AXLE_Y, 0),
    ):
        place(car, corner, placement(x=x, y=y, z=WHEEL_RADIUS, rz=turn), label)

    shapes.UpdateAssemblies()
    return doc


def _nut_location(angle_deg):
    """A lug nut turned `angle_deg` about the wheel axis, then the wheel turned to face X."""
    trsf = gp_Trsf()
    trsf.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), math.radians(90))
    spin = gp_Trsf()
    spin.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), math.radians(angle_deg))
    trsf.Multiply(spin)
    return TopLoc_Location(trsf)


def write_car_step(path: Path) -> Path:
    path = Path(path)
    writer = STEPCAFControl_Writer()
    writer.SetNameMode(True)
    writer.SetColorMode(True)
    writer.SetMaterialMode(True)
    if not writer.Transfer(build_car_document(), STEPControl_StepModelType.STEPControl_AsIs):
        raise RuntimeError("Could not transfer the car to STEP")
    if writer.Write(str(path)) != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f"Could not write {path}")
    return path


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "aster-c1.step")
    write_car_step(target)
    print(f"Wrote {target} ({target.stat().st_size / 1024:.0f} KB)")
