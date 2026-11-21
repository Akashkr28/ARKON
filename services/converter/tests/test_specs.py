"""Spec extraction on a part whose every number is known by construction."""

import math

import pytest
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCP.Message import Message_ProgressRange
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_StepModelType
from OCP.TCollection import TCollection_ExtendedString, TCollection_HAsciiString
from OCP.TDataStd import TDataStd_Name
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.XCAFDoc import XCAFDoc_DocumentTool

from holocad_converter.cad_document import new_document, shape_tool
from holocad_converter.convert import convert_step_to_glb, specs_document

STEEL_G_CM3 = 7.85


def _bracket():
    """100 × 60 × 20 mm block, two Ø10 through holes, a Ø20 × 30 mm boss on top,
    and its four vertical outside edges rounded to R5."""
    block = BRepPrimAPI_MakeBox(100, 60, 20).Shape()
    rounded = BRepFilletAPI_MakeFillet(block)
    explorer = TopExp_Explorer(block, TopAbs_EDGE)
    while explorer.More():
        edge = TopoDS.Edge(explorer.Current())
        curve = BRepAdaptor_Curve(edge)
        start, end = curve.Value(curve.FirstParameter()), curve.Value(curve.LastParameter())
        if abs(start.X() - end.X()) < 1e-6 and abs(start.Y() - end.Y()) < 1e-6:  # vertical
            rounded.Add(5.0, edge)
        explorer.Next()
    shape = rounded.Shape()
    for x in (20, 80):
        hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, 30, -1), gp_Dir(0, 0, 1)), 5, 22).Shape()
        shape = BRepAlgoAPI_Cut(shape, hole).Shape()
    boss = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(50, 30, 20), gp_Dir(0, 0, 1)), 10, 30).Shape()
    return BRepAlgoAPI_Fuse(shape, boss).Shape()


@pytest.fixture(scope="module")
def bracket(tmp_path_factory):
    folder = tmp_path_factory.mktemp("bracket")
    doc = new_document()
    label = shape_tool(doc).AddShape(_bracket(), False)
    TDataStd_Name.Set_s(label, TCollection_ExtendedString("Mounting bracket"))
    materials = XCAFDoc_DocumentTool.MaterialTool_s(doc.Main())
    steel = materials.AddMaterial(
        TCollection_HAsciiString("Steel AISI 1045"),
        TCollection_HAsciiString(""),
        STEEL_G_CM3,
        TCollection_HAsciiString("density"),
        TCollection_HAsciiString("POSITIVE_RATIO_MEASURE"),
    )
    materials.SetMaterial(label, steel)
    writer = STEPCAFControl_Writer()
    writer.SetNameMode(True)
    writer.SetMaterialMode(True)
    writer.Transfer(doc, STEPControl_StepModelType.STEPControl_AsIs, None, Message_ProgressRange())
    step = folder / "bracket.step"
    writer.Write(str(step))
    # Give the product a part number and description, as CAD systems write them.
    text = step.read_text().replace(
        "PRODUCT('Mounting bracket','Mounting bracket',''",
        "PRODUCT('MB-2040','Mounting bracket','Laser-cut and machined'",
    )
    step.write_text(text)
    return convert_step_to_glb(step, folder / "bracket.glb", "draft").parts[0]["spec"]


def test_identity_from_the_step_file(bracket):
    assert bracket["product_name"] == "Mounting bracket"
    assert bracket["part_number"] == "MB-2040"
    assert bracket["description"] == "Laser-cut and machined"
    assert bracket["material"] == {"name": "Steel AISI 1045", "density_kg_m3": pytest.approx(7850)}


def test_exact_size_volume_area_and_mass(bracket):
    assert bracket["overall_size_mm"] == pytest.approx([100, 60, 50], abs=0.01)
    corner_loss = 4 * (25 - math.pi * 25 / 4) * 20  # R5 rounds take a sliver off each corner
    volume = 100 * 60 * 20 - corner_loss - 2 * math.pi * 25 * 20 + math.pi * 100 * 30
    assert bracket["volume_mm3"] == pytest.approx(volume, rel=1e-6)
    assert bracket["mass_kg"] == pytest.approx(volume * 1e-9 * 7850, rel=1e-6)
    assert bracket["surface_area_mm2"] > 0
    assert bracket["solids"] == 1


def test_centre_of_mass_in_viewer_metres(bracket):
    x, y, z = bracket["centre_of_mass_m"]
    assert x == pytest.approx(0.05, abs=1e-6)  # symmetric in X about 50 mm
    assert z == pytest.approx(-0.03, abs=1e-6)  # CAD Y = 30 mm → viewer Z = -0.03 m
    assert 0.01 < y < 0.02  # above mid-height: the boss sits on top


def test_recognises_holes_boss_and_fillets(bracket):
    features = bracket["features"]
    assert features["holes"] == [{"diameter": 10.0, "depth": 20.0, "count": 2}]
    assert features["outer_diameters"] == [{"diameter": 20.0, "length": 30.0, "count": 1}]
    assert features["fillets"] == [{"radius": 5.0, "count": 4}]
    assert bracket["surfaces"]["cylinder"] == 2 + 1 + 4


def test_specs_document_is_camel_case(tmp_path):
    from holocad_converter.convert import ConversionResult

    result = ConversionResult(tmp_path, 0, 1, 0, {}, [{"index": 0, "name": "A", "spec": {"volume_mm3": 1, "features": {"outer_diameters": []}}}])
    assert specs_document(result)["parts"] == [{"index": 0, "name": "A", "spec": {"volumeMm3": 1, "features": {"outerDiameters": []}}}]
