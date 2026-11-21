"""Exact engineering data for every part, measured on the CAD geometry (B-rep), not the mesh.

For each part the viewer shows (one per GLB mesh node, same order) we report:

- identity from the STEP file: part number, description, material (when the file has them)
- overall size: the tightest box around the part in its own orientation (length ≥ width ≥ height)
- volume, surface area, centre of mass; mass when the file gives a density
- topology: solids, faces by surface type, edges
- recognised features: holes, outer diameters (shafts, pins, bosses), fillets and rounds

Units: millimetres (mm, mm², mm³), kilograms, kg/m³. Positions (centre of mass) are in
the viewer's frame: metres, glTF axes (Y up), the same as the GLB and the model bounds.
"""

import math
from collections import Counter, defaultdict
from dataclasses import dataclass

from OCP.Bnd import Bnd_OBB
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.GeomAbs import GeomAbs_SurfaceType
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Vec
from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
from OCP.TDataStd import TDataStd_NamedData, TDataStd_TreeNode
from OCP.TDF import TDF_Label, TDF_Tool
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_Orientation, TopAbs_SOLID
from OCP.TopExp import TopExp
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.collections import IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as ShapeMap
from OCP.collections import Sequence_TDF_Label
from OCP.XCAFDoc import XCAFDoc, XCAFDoc_DocumentTool, XCAFDoc_Material, XCAFDoc_MaterialTool, XCAFDoc_ShapeTool
from OCP.XCAFPrs import XCAFPrs_DocumentExplorer, XCAFPrs_DocumentExplorerFlags_OnlyLeafNodes

from .cad_document import DOCUMENT_UNIT_IN_METRES

SURFACE_NAMES = {
    GeomAbs_SurfaceType.GeomAbs_Plane: "plane",
    GeomAbs_SurfaceType.GeomAbs_Cylinder: "cylinder",
    GeomAbs_SurfaceType.GeomAbs_Cone: "cone",
    GeomAbs_SurfaceType.GeomAbs_Sphere: "sphere",
    GeomAbs_SurfaceType.GeomAbs_Torus: "torus",
    GeomAbs_SurfaceType.GeomAbs_BezierSurface: "freeform",
    GeomAbs_SurfaceType.GeomAbs_BSplineSurface: "freeform",
    GeomAbs_SurfaceType.GeomAbs_SurfaceOfRevolution: "revolved",
    GeomAbs_SurfaceType.GeomAbs_SurfaceOfExtrusion: "extruded",
    GeomAbs_SurfaceType.GeomAbs_OffsetSurface: "offset",
}

FULL_TURN = 2 * math.pi
# A cylinder group covering at least this much of a turn is a whole hole or shaft;
# STEP files often split one into two half-cylinders.
WHOLE = 0.97 * FULL_TURN
# A partial cylinder up to this wide is a fillet or round (usually exactly 90°).
FILLET_MAX_SPAN = math.radians(100)


@dataclass(frozen=True)
class LeafNode:
    """One part as placed in the assembly: what the GLB writer turns into one mesh node."""

    name: str
    product_label: TDF_Label
    shape: object  # TopoDS_Shape, located in the assembly


def _label_name(label) -> str | None:
    from OCP.TDataStd import TDataStd_Name

    attr = TDataStd_Name()
    return attr.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), attr) else None


def leaf_nodes(doc) -> list[LeafNode]:
    """Parts in the order RWGltf_CafWriter writes them (it walks the same explorer)."""
    nodes = []
    explorer = XCAFPrs_DocumentExplorer(doc, XCAFPrs_DocumentExplorerFlags_OnlyLeafNodes)
    while explorer.More():
        node = explorer.Current()
        product = node.RefLabel
        # Same rule as the writer's InstanceOrProduct naming.
        name = _label_name(node.Label) if node.Label != product else None
        name = name or _label_name(product) or ""
        shape = XCAFDoc_ShapeTool.GetShape_s(product).Located(node.Location)
        nodes.append(LeafNode(name, product, shape))
        explorer.Next()
    return nodes


# ---- identity -------------------------------------------------------------------------


def _named_string(data: TDataStd_NamedData, key: str) -> str | None:
    if not data.HasStrings():
        return None
    strings = data.GetStringsContainer()
    key = TCollection_ExtendedString(key)
    value = strings.Find(key).ToExtString().strip() if strings.IsBound(key) else ""
    return value or None


def _entry(label) -> str:
    text = TCollection_AsciiString()
    TDF_Tool.Entry_s(label, text)
    return text.ToCString()


def material_index(doc) -> dict[str, dict]:
    """Label entry → {name, density_kg_m3} for every part the STEP file gives a material.

    Walked from the materials to the parts that refer to them: looking the reference
    up from the part's side crashes in this OCCT binding.
    """
    found = {}
    labels = Sequence_TDF_Label()
    XCAFDoc_DocumentTool.MaterialTool_s(doc.Main()).GetMaterialLabels(labels)
    for i in range(1, labels.Length() + 1):
        label = labels.Value(i)
        material, refs = XCAFDoc_Material(), TDataStd_TreeNode()
        if not label.FindAttribute(XCAFDoc_Material.GetID_s(), material):
            continue
        if not label.FindAttribute(XCAFDoc.MaterialRefGUID_s(), refs) or not refs.HasFirst():
            continue
        name = (material.GetName().ToCString() if material.GetName() else "").strip()
        child = refs.First()
        while True:
            part = child.Label()
            # Stored in the document's units: g/mm³. 1 g/mm³ = 10⁶ kg/m³.
            density = XCAFDoc_MaterialTool.GetDensityForShape_s(part) * 1e6
            found[_entry(part)] = {"name": name or None, "density_kg_m3": round(density, 3) if density > 0 else None}
            if not child.HasNext():
                break
            child = child.Next()
    return found


def _material_of(product: TDF_Label, materials: dict) -> dict | None:
    entry = _entry(product)
    if entry in materials:
        return materials[entry]
    # A part made of several solids gets its material on each solid's sub-shape label
    # ("0:1:1:5:1", "0:1:1:5:2"…). One material for all of them is the part's material.
    found = {str(m) for key, m in materials.items() if key.startswith(entry + ":")}
    if len(found) == 1:
        return next(m for key, m in materials.items() if key.startswith(entry + ":"))
    return None


def identity(product: TDF_Label, materials: dict) -> dict:
    data = TDataStd_NamedData()
    has_data = product.FindAttribute(TDataStd_NamedData.GetID_s(), data)
    name = _label_name(product)
    part_number = _named_string(data, "ProductID") if has_data else None
    description = _named_string(data, "Description") if has_data else None
    return {
        "product_name": name,
        # Only worth showing when it says something the name doesn't.
        "part_number": part_number if part_number and part_number != name else None,
        "description": description if description and description != name else None,
        "material": _material_of(product, materials),
    }


# ---- geometry -------------------------------------------------------------------------


def _sub_shapes(shape, kind) -> list:
    found = ShapeMap()
    TopExp.MapShapes_s(shape, kind, found)
    return [found.FindKey(i) for i in range(1, found.Extent() + 1)]


def _overall_size(shape) -> list[float]:
    """The tightest box in the part's own orientation, sorted: length, width, height."""
    obb = Bnd_OBB()
    BRepBndLib.AddOBB_s(shape, obb, False, True, False)
    if obb.IsVoid():
        return [0.0, 0.0, 0.0]
    return sorted((round(2 * h, 3) for h in (obb.XHSize(), obb.YHSize(), obb.ZHSize())), reverse=True)


def _to_viewer_metres(point) -> list[float]:
    # CAD is Z-up, glTF is Y-up: (x, y, z) → (x, z, -y); same as the model bounds.
    s = DOCUMENT_UNIT_IN_METRES
    return [round(point.X() * s, 6) + 0.0, round(point.Z() * s, 6) + 0.0, round(-point.Y() * s, 6) + 0.0]


def _cylinder_face(face):
    """(radius, axis point, axis direction, angular span, axial interval, concave) or None."""
    surface = BRepAdaptor_Surface(face, True)
    if surface.GetType() != GeomAbs_SurfaceType.GeomAbs_Cylinder:
        return None
    cylinder = surface.Cylinder()
    axis = cylinder.Axis()
    origin, direction = axis.Location(), axis.Direction()
    u0, u1 = surface.FirstUParameter(), surface.LastUParameter()
    v0, v1 = surface.FirstVParameter(), surface.LastVParameter()

    # Concave (a hole) when the outward normal points toward the axis.
    point, du, dv = surface.Value((u0 + u1) / 2, (v0 + v1) / 2), gp_Vec(), gp_Vec()
    surface.D1((u0 + u1) / 2, (v0 + v1) / 2, point, du, dv)
    normal = du.Crossed(dv)
    if face.Orientation() == TopAbs_Orientation.TopAbs_REVERSED:
        normal.Reverse()
    to_point = gp_Vec(origin, point)
    radial = to_point - gp_Vec(direction).Multiplied(to_point.Dot(gp_Vec(direction)))
    concave = normal.Dot(radial) < 0

    # Express the axis canonically so both halves of a split hole land in one group.
    d = [direction.X(), direction.Y(), direction.Z()]
    first = next(c for c in d if abs(c) > 1e-9)
    if first < 0:
        d = [-c for c in d]
    o = [origin.X(), origin.Y(), origin.Z()]
    along = sum(a * b for a, b in zip(o, d))
    foot = [a - along * b for a, b in zip(o, d)]  # where the axis line meets the plane through 0
    sign = 1 if first > 0 else -1
    interval = sorted((along + sign * v0, along + sign * v1))
    return cylinder.Radius(), foot, d, u1 - u0, interval, concave


def _round_key(values, step=0.01):
    return tuple(round(v / step) * step + 0.0 for v in values)


def _merge_along_axis(pieces, tolerance=0.01):
    merged = []
    for lo, hi, span in sorted(pieces):
        if merged and lo <= merged[-1][1] + tolerance:
            last = merged[-1]
            merged[-1] = (last[0], max(last[1], hi), last[2] + span)
        else:
            merged.append((lo, hi, span))
    return merged


def features(faces) -> dict:
    groups = defaultdict(list)  # same axis line, radius and side → [(lo, hi, span)]
    fillet_radii = Counter()
    for face in faces:
        surface = BRepAdaptor_Surface(face, True)
        if surface.GetType() == GeomAbs_SurfaceType.GeomAbs_Torus:
            fillet_radii[round(surface.Torus().MinorRadius(), 2)] += 1
            continue
        found = _cylinder_face(face)
        if not found:
            continue
        radius, foot, direction, span, (lo, hi), concave = found
        key = (concave, round(radius, 3), _round_key(direction, 1e-4), _round_key(foot, 0.01))
        groups[key].append((lo, hi, span))

    holes, outer = Counter(), Counter()
    for (concave, radius, _d, _f), pieces in groups.items():
        # Faces on one axis make one feature only where their lengths overlap or touch:
        # two halves of a split hole merge, a row of separate rings doesn't.
        for lo, hi, span in _merge_along_axis(pieces):
            size = (round(2 * radius, 2), round(hi - lo, 2))
            if span >= WHOLE:
                (holes if concave else outer)[size] += 1
            elif span <= FILLET_MAX_SPAN:
                fillet_radii[round(radius, 2)] += 1

    def listing(counter, a, b):
        return [{a: k[0], b: k[1], "count": n} for k, n in sorted(counter.items())]

    return {
        "holes": listing(holes, "diameter", "depth"),
        # Convex whole cylinders: shafts, pins, bosses, and round outer edges like a disc's.
        "outer_diameters": listing(outer, "diameter", "length"),
        "fillets": [{"radius": r, "count": n} for r, n in sorted(fillet_radii.items())],
    }


@dataclass
class _ShapeFacts:
    """What doesn't change when the same part is placed again elsewhere."""

    overall_size: list
    volume: float | None
    area: float
    centre_local: object  # gp_Pnt, or None
    solids: int
    faces: int
    edges: int
    surfaces: dict
    features: dict


def _facts(shape) -> _ShapeFacts:
    solids = _sub_shapes(shape, TopAbs_SOLID)
    faces = [TopoDS.Face(f) for f in _sub_shapes(shape, TopAbs_FACE)]
    surfaces = Counter(SURFACE_NAMES.get(BRepAdaptor_Surface(f, True).GetType(), "other") for f in faces)

    area_props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, area_props)
    volume, centre = None, None
    if solids:
        volume_props = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape, volume_props)
        if volume_props.Mass() > 0:
            volume, centre = volume_props.Mass(), volume_props.CentreOfMass()
    if centre is None and area_props.Mass() > 0:
        centre = area_props.CentreOfMass()  # sheet or surface model: centre of the area

    return _ShapeFacts(
        overall_size=_overall_size(shape),
        volume=volume,
        area=area_props.Mass(),
        centre_local=centre,
        solids=len(solids),
        faces=len(faces),
        edges=len(_sub_shapes(shape, TopAbs_EDGE)),
        surfaces=dict(sorted(surfaces.items(), key=lambda kv: -kv[1])),
        features=features(faces),
    )


def part_specs(doc) -> list[tuple[str, dict]]:
    """(node name, spec) for every part, in GLB node order.

    A part placed several times is measured once; only its centre of mass moves.
    """
    facts_by_product, identity_by_product = {}, {}
    materials = material_index(doc)
    results = []
    for node in leaf_nodes(doc):
        key = _entry(node.product_label)  # e.g. "0:1:1:3"; Tag() alone isn't unique
        if key not in facts_by_product:
            # Measured unplaced; the node's location carries the whole placement.
            product_shape = XCAFDoc_ShapeTool.GetShape_s(node.product_label).Located(TopLoc_Location())
            facts_by_product[key] = _facts(product_shape)
            identity_by_product[key] = identity(node.product_label, materials)
        facts, ident = facts_by_product[key], identity_by_product[key]

        centre = None
        if facts.centre_local is not None:
            placed = node.shape.Location().Transformation()
            centre = _to_viewer_metres(facts.centre_local.Transformed(placed))
        density = (ident["material"] or {}).get("density_kg_m3")
        volume = round(facts.volume, 3) if facts.volume is not None else None
        results.append(
            (
                node.name,
                {
                    **ident,
                    "overall_size_mm": facts.overall_size,
                    "volume_mm3": volume,
                    "surface_area_mm2": round(facts.area, 3),
                    "mass_kg": round(volume * 1e-9 * density, 6) if volume and density else None,
                    "centre_of_mass_m": centre,
                    "solids": facts.solids,
                    "faces": facts.faces,
                    "edges": facts.edges,
                    "surfaces": facts.surfaces,
                    "features": facts.features,
                },
            )
        )
    return results


def attach_specs(parts: list[dict], specs: list[tuple[str, dict]]) -> None:
    """Give each GLB part its spec. Matched in order by name, so a CAD node the writer
    skipped (no surfaces to mesh) can't shift every later part onto the wrong spec."""
    remaining = iter(specs)
    for part in parts:
        for name, spec in remaining:
            if name == part["name"] or (not name and part["name"].startswith("Part ")):
                part["spec"] = spec
                break
        else:
            return
