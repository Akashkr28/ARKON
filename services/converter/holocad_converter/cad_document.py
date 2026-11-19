"""Small helpers around OCCT's XCAF documents (shapes + names + colours + assembly tree)."""

from OCP.TCollection import TCollection_ExtendedString
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_DocumentTool

# Everything inside a document is kept in millimetres. The STEP reader converts
# each file's own units to this, and the glTF writer scales it to metres.
DOCUMENT_UNIT_IN_METRES = 0.001


def new_document() -> TDocStd_Document:
    doc = TDocStd_Document(TCollection_ExtendedString("MDTV-XCAF"))
    XCAFApp_Application.GetApplication_s().InitDocument(doc)
    XCAFDoc_DocumentTool.SetLengthUnit_s(doc, DOCUMENT_UNIT_IN_METRES)
    return doc


def shape_tool(doc):
    return XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())


def color_tool(doc):
    return XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
