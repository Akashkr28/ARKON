"""Face- and edge-level data for the viewer's inspector: which mesh triangles make up each
CAD face, what each face is (flat, a Ø12 hole, an R5 fillet…), and every CAD edge as a
polyline with its type, length and radius.

How triangles map to faces: the glTF writer walks each part's faces with
RWMesh_FaceIterator (as we do here) and, with merged faces, puts faces of one style
(colour) into one primitive, primitives in order of each style's first face, triangles in
face order. We rebuild that layout and check it against the GLB's actual primitive sizes;
a part that doesn't match gets no face data rather than wrong face data.

Positions are in each part's own glTF node frame (metres, Y up): the same frame as its
mesh vertices, so the viewer can draw them as children of the mesh.
"""

import math

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepGProp import BRepGProp
from OCP.GCPnts import GCPnts_AbscissaPoint, GCPnts_QuasiUniformDeflection
from OCP.GeomAbs import GeomAbs_CurveType, GeomAbs_SurfaceType
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Vec
from OCP.RWMesh import RWMesh_FaceIterator
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_Orientation
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_ShapeTool
from OCP.XCAFPrs import XCAFPrs_DocumentExplorer, XCAFPrs_DocumentExplorerFlags_OnlyLeafNodes

from .cad_document import DOCUMENT_UNIT_IN_METRES
from .specs import SURFACE_NAMES, _cylinder_face, _entry, _sub_shapes

CURVE_NAMES = {
    GeomAbs_CurveType.GeomAbs_Line: "line",
    GeomAbs_CurveType.GeomAbs_Circle: "circle",
    GeomAbs_CurveType.GeomAbs_Ellipse: "ellipse",
    GeomAbs_CurveType.GeomAbs_Hyperbola: "hyperbola",
    GeomAbs_CurveType.GeomAbs_Parabola: "parabola",
    GeomAbs_CurveType.GeomAbs_BezierCurve: "spline",
    GeomAbs_CurveType.GeomAbs_BSplineCurve: "spline",
    GeomAbs_CurveType.GeomAbs_OffsetCurve: "offset",
}


def _round(value, digits=3):
    return round(value, digits) + 0.0


def _viewer_direction(vec) -> list[float]:
    # CAD (x, y, z) → glTF (x, z, -y), same as positions.
    return [_round(vec.X(), 4), _round(vec.Z(), 4), _round(-vec.Y(), 4)]


def _viewer_points(points) -> list[float]:
    s = DOCUMENT_UNIT_IN_METRES
    flat = []
    for p in points:
        flat += [_round(p.X() * s, 6), _round(p.Z() * s, 6), _round(-p.Y() * s, 6)]
    return flat


def describe_face(face) -> dict:
    surface = BRepAdaptor_Surface(face, True)
    kind = surface.GetType()
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    info = {"type": SURFACE_NAMES.get(kind, "other"), "area": _round(props.Mass())}
    if kind == GeomAbs_SurfaceType.GeomAbs_Plane:
        normal = gp_Vec(surface.Plane().Axis().Direction())
        if face.Orientation() == TopAbs_Orientation.TopAbs_REVERSED:
            normal.Reverse()
        info["normal"] = _viewer_direction(normal)
    elif kind == GeomAbs_SurfaceType.GeomAbs_Cylinder:
        radius, _foot, _dir, span, (lo, hi), concave = _cylinder_face(face)
        info.update(radius=_round(radius), concave=concave, sweep=_round(math.degrees(span), 1), length=_round(hi - lo))
    elif kind == GeomAbs_SurfaceType.GeomAbs_Cone:
        cone = surface.Cone()
        info.update(radius=_round(cone.RefRadius()), half_angle=_round(math.degrees(cone.SemiAngle()), 2))
    elif kind == GeomAbs_SurfaceType.GeomAbs_Sphere:
        info["radius"] = _round(surface.Sphere().Radius())
    elif kind == GeomAbs_SurfaceType.GeomAbs_Torus:
        torus = surface.Torus()
        info.update(radius=_round(torus.MinorRadius()), major_radius=_round(torus.MajorRadius()))
    return info


def describe_edge(edge, deflection: float) -> dict | None:
    if BRep_Tool.Degenerated_s(edge):
        return None
    curve = BRepAdaptor_Curve(edge)
    kind = curve.GetType()
    info = {
        "type": CURVE_NAMES.get(kind, "other"),
        "length": _round(GCPnts_AbscissaPoint.Length_s(curve)),
    }
    if kind == GeomAbs_CurveType.GeomAbs_Circle:
        span = abs(curve.LastParameter() - curve.FirstParameter())
        info.update(radius=_round(curve.Circle().Radius()), full=span >= 2 * math.pi - 1e-6)
    sampler = GCPnts_QuasiUniformDeflection(curve, deflection)
    if not sampler.IsDone() or sampler.NbPoints() < 2:
        points = [curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())]
    else:
        points = [sampler.Value(i) for i in range(1, sampler.NbPoints() + 1)]
    info["points"] = _viewer_points(points)
    return info


def _real_edges(shape) -> list:
    """Edges you can see on the part: not the seam where a cylinder's surface closes on
    itself. A seam is the one edge that occurs twice in its own face's boundary."""
    seams = set()
    faces = TopExp_Explorer(shape, TopAbs_FACE)
    while faces.More():
        seen = set()
        edges = TopExp_Explorer(faces.Current(), TopAbs_EDGE)
        while edges.More():
            key = hash(edges.Current())  # same edge, either orientation → same hash
            if key in seen:
                seams.add(key)
            seen.add(key)
            edges.Next()
        faces.Next()
    return [TopoDS.Edge(e) for e in _sub_shapes(shape, TopAbs_EDGE) if hash(e) not in seams]


def _face_layout(product_label, style, primitive_sizes):
    """Faces with their triangle range [primitive, first triangle, count], or None if
    the layout doesn't reproduce the GLB's primitives."""
    styles, counts, faces = [], [], []
    iterator = RWMesh_FaceIterator(product_label, TopLoc_Location(), True, style)
    while iterator.More():
        if not iterator.IsEmptyMesh():
            face_style = iterator.FaceStyle()
            primitive = next((i for i, s in enumerate(styles) if s.IsEqual(face_style)), None)
            if primitive is None:
                styles.append(face_style)
                counts.append(0)
                primitive = len(styles) - 1
            triangles = iterator.NbTriangles()
            faces.append((TopoDS.Face(iterator.Face()), [primitive, counts[primitive], triangles]))
            counts[primitive] += triangles
        iterator.Next()
    return faces if counts == list(primitive_sizes) else None


def _has_triangles(label, style) -> bool:
    iterator = RWMesh_FaceIterator(label, TopLoc_Location(), True, style)
    while iterator.More():
        if not iterator.IsEmptyMesh() and iterator.NbTriangles() > 0:
            return True
        iterator.Next()
    return False


def part_faces(doc, parts: list[dict], deflection: float) -> dict:
    """The viewer's face/edge document. `parts` are the GLB parts (glb.list_parts), in
    order; each carries its primitives' triangle counts."""
    products, product_index, part_products = [], {}, []
    explorer = XCAFPrs_DocumentExplorer(doc, XCAFPrs_DocumentExplorerFlags_OnlyLeafNodes)
    nodes = []
    while explorer.More():
        node = explorer.Current()
        # The writer makes no mesh node for a part with nothing to draw; skip those too.
        if _has_triangles(node.RefLabel, node.Style):
            nodes.append((node.RefLabel, node.Style))
        explorer.Next()

    remaining = iter(nodes)
    for part in parts:
        node = next(remaining, None)
        if node is None:
            part_products.append(None)
            continue
        label, style = node
        sizes = tuple(part.get("primitive_triangles") or ())
        key = (_entry(label), sizes)
        if key not in product_index:
            layout = _face_layout(label, style, sizes)
            if layout is None:
                product_index[key] = None
            else:
                shape = XCAFDoc_ShapeTool.GetShape_s(label).Located(TopLoc_Location())
                edges = [describe_edge(e, deflection) for e in _real_edges(shape)]
                products.append(
                    {
                        "faces": [{**describe_face(face), "tri": tri} for face, tri in layout],
                        "edges": [e for e in edges if e],
                    }
                )
                product_index[key] = len(products) - 1
        part_products.append(product_index[key])

    return {
        "units": {"length": "mm", "area": "mm2", "angle": "deg", "points": "m (part's node frame, Y up)"},
        "products": products,
        "parts": part_products,  # by part (spec) index → products index, or null
    }
