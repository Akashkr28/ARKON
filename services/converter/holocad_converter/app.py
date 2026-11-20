"""HTTP wrapper around the converter. Only the HoloCAD API talks to this, on loopback.

Run:  uv run uvicorn holocad_converter.app:app --host 127.0.0.1 --port 8001
"""

import logging
import threading
from importlib.metadata import version
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .convert import ConversionError, convert_step_to_glb
from .storage import UnsafePathError, resolve_inside, storage_root

log = logging.getLogger("holocad.converter")
app = FastAPI(title="HoloCAD converter")

# Meshing a big assembly can use several GB of RAM; convert one file at a time.
# The API's worker also sends one job at a time, so this is a safety net.
conversion_lock = threading.Lock()


class ConvertRequest(BaseModel):
    input_path: str  # relative to STORAGE_DIR
    output_path: str  # relative to STORAGE_DIR
    quality: Literal["draft", "standard", "fine"] = "standard"


@app.get("/health")
def health():
    return {"status": "ok", "ocp": version("cadquery-ocp"), "storage": str(storage_root())}


# Plain `def`, not `async def`: FastAPI runs it in a worker thread, so a long
# conversion doesn't block /health.
@app.post("/convert")
def convert(request: ConvertRequest):
    root = storage_root()
    try:
        source = resolve_inside(root, request.input_path)
        target = resolve_inside(root, request.output_path)
    except UnsafePathError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not source.is_file():
        raise HTTPException(status_code=404, detail=f"Input file not found: {request.input_path}")
    if target.suffix.lower() != ".glb":
        raise HTTPException(status_code=400, detail="Output path must end in .glb")

    with conversion_lock:
        try:
            result = convert_step_to_glb(source, target, request.quality)
        except ConversionError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    log.info("converted %s → %s in %.1fs", request.input_path, request.output_path, result.seconds)
    return result.to_dict()
