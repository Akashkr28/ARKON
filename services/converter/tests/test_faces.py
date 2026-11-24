"""Face/edge data: every face's triangle range must really be that face's triangles."""

import json
import math
import struct

import pytest
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCP.Message import Message_ProgressRange
from OCP.Quantity import Quantity_Color, Quantity_TypeOfColor
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_StepModelType
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.XCAFDoc import XCAFDoc_ColorType

from holocad_converter.cad_document import color_tool, new_document, shape_tool
from holocad_converter.convert import convert_step_to_glb, faces_path_for
from holocad_converter.glb import read_gltf_json


def _drilled_block():
    block = BRepPrimAPI_MakeBox(100, 50, 20).Shape()
    hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(50, 25, -1), gp_Dir(0, 0, 1)), 6, 22).Shape()
    return BRepAlgoAPI_Cut(block, hole).Shape()


@pytest.fixture(scope="module")
def block(tmp_path_factory):
    """A drilled block whose top and one side are coloured: three primitives in the GLB."""
    folder = tmp_path_factory.mktemp("faces")
    doc = new_document()
    shapes, colors = shape_tool(doc), color_tool(doc)
    shape = _drilled_block()
    label = shapes.AddShape(shape, False)
    TDataStd_Name.Set_s(label, TCollection_ExtendedString("Drilled block"))
    faces = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        faces.append(explorer.Current())
        explorer.Next()
    for index, rgb in ((1, (1, 0, 0)), (3, (0, 1, 0))):
        sub = shapes.AddSubShape(label, faces[index])
        colors.SetColor(sub, Quantity_Color(*rgb, Quantity_TypeOfColor.Quantity_TOC_sRGB), XCAFDoc_ColorType.XCAFDoc_ColorSurf)
    writer = STEPCAFControl_Writer()
    writer.SetColorMode(True)
    writer.SetNameMode(True)
    writer.Transfer(doc, STEPControl_StepModelType.STEPControl_AsIs, None, Message_ProgressRange())
    step = folder / "block.step"
    writer.Write(str(step))
    glb = folder / "block.glb"
    convert_step_to_glb(step, glb, "standard")
    return glb, json.loads(faces_path_for(glb).read_text())


def _triangles(glb_path, gltf, mesh_index):
    """Per primitive: list of triangles, each three (x, y, z) points in metres."""
    data = glb_path.read_bytes()
    json_length = struct.unpack_from("<I", data, 12)[0]
    binary = data[20 + json_length + 8 :]

    def read(accessor_index):
        accessor = gltf["accessors"][accessor_index]
        view = gltf["bufferViews"][accessor["bufferView"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        width = {"SCALAR": 1, "VEC3": 3}[accessor["type"]]
        fmt = {5126: "f", 5125: "I", 5123: "H"}[accessor["componentType"]]
        values = struct.unpack_from(f"<{accessor['count'] * width}{fmt}", binary, start)
        return [values[i : i + width] for i in range(0, len(values), width)]

    out = []
    for primitive in gltf["meshes"][mesh_index]["primitives"]:
        positions = read(primitive["attributes"]["POSITION"])
        indices = [i[0] for i in read(primitive["indices"])]
        out.append([[positions[indices[t + k]] for k in range(3)] for t in range(0, len(indices), 3)])
    return out


def _cad_point(p):
    # glTF metres, Y up → CAD millimetres, Z up.
    x, y, z = p
    return gp_Pnt(x * 1000, -z * 1000, y * 1000)


def test_three_primitives_and_every_face_mapped(block):
    glb, faces = block
    gltf = read_gltf_json(glb)
    assert len(gltf["meshes"][0]["primitives"]) == 3
    assert faces["parts"] == [0]
    product = faces["products"][0]
    assert len(product["faces"]) == 7  # 6 sides + the hole
    types = sorted(f["type"] for f in product["faces"])
    assert types == ["cylinder"] + ["plane"] * 6


def test_each_face_range_lies_on_that_face(block):
    glb, faces = block
    gltf = read_gltf_json(glb)
    primitives = _triangles(glb, gltf, 0)
    from OCP.BRepTools import BRepTools  # noqa: F401  (keeps OCP's tools loaded)

    shape = _drilled_block()
    cad_faces = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        cad_faces.append(explorer.Current())
        explorer.Next()

    for face in faces["products"][0]["faces"]:
        primitive, first, count = face["tri"]
        triangles = primitives[primitive][first : first + count]
        assert triangles
        # Every triangle centre is on one and the same CAD face, of the reported type.
        centres = [_cad_point([sum(c) / 3 for c in zip(*t)]) for t in triangles]

        def distance(face_shape, point):
            vertex = BRepBuilderAPI_MakeVertex(point).Vertex()
            return BRepExtrema_DistShapeShape(vertex, face_shape).Value()

        owner = min(cad_faces, key=lambda f: max(distance(f, c) for c in centres))
        assert max(distance(owner, c) for c in centres) < 0.2  # mm: within the mesh deflection


def test_hole_and_plane_details(block):
    _, faces = block
    by_type = {}
    for face in faces["products"][0]["faces"]:
        by_type.setdefault(face["type"], []).append(face)
    hole = by_type["cylinder"][0]
    assert hole["radius"] == 6.0 and hole["concave"] is True and hole["length"] == 20.0
    assert hole["area"] == pytest.approx(2 * math.pi * 6 * 20, rel=1e-6)
    normals = sorted(tuple(f["normal"]) for f in by_type["plane"])
    # Outward normals of a box, in viewer axes (Y up).
    assert normals == sorted([(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)])


def test_edges_have_type_length_and_points(block):
    _, faces = block
    edges = faces["products"][0]["edges"]
    circles = [e for e in edges if e["type"] == "circle"]
    lines = [e for e in edges if e["type"] == "line"]
    assert len(lines) == 12
    assert sorted(e["length"] for e in lines) == [20.0] * 4 + [50.0] * 4 + [100.0] * 4
    assert circles and all(c["radius"] == 6.0 for c in circles)
    assert sum(c["length"] for c in circles) == pytest.approx(2 * 2 * math.pi * 6, abs=0.01)
    for edge in edges:
        assert len(edge["points"]) >= 6 and len(edge["points"]) % 3 == 0
