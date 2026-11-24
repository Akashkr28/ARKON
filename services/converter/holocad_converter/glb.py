"""Reads part information back out of a GLB, so the metadata describes exactly
what the viewer will load (same names, same order)."""

import json
import struct
from pathlib import Path

GLB_MAGIC = b"glTF"
JSON_CHUNK = 0x4E4F534A  # "JSON"


def read_gltf_json(path: Path) -> dict:
    with open(path, "rb") as f:
        magic, _version, _length = struct.unpack("<4sII", f.read(12))
        if magic != GLB_MAGIC:
            raise ValueError(f"{path.name} is not a GLB file")
        chunk_length, chunk_type = struct.unpack("<II", f.read(8))
        if chunk_type != JSON_CHUNK:
            raise ValueError(f"{path.name} has no JSON chunk")
        return json.loads(f.read(chunk_length))


def _linear_to_srgb(channel: float) -> float:
    if channel <= 0.0031308:
        return channel * 12.92
    return 1.055 * channel ** (1 / 2.4) - 0.055


def _material_hex(gltf: dict, material_index) -> str | None:
    if material_index is None:
        return None
    factor = gltf["materials"][material_index].get("pbrMetallicRoughness", {}).get("baseColorFactor")
    if not factor:
        return None
    r, g, b = (round(_linear_to_srgb(c) * 255) for c in factor[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def _triangle_count(gltf: dict, mesh: dict) -> int:
    total = 0
    for primitive in mesh["primitives"]:
        accessor_index = primitive.get("indices", primitive["attributes"]["POSITION"])
        total += gltf["accessors"][accessor_index]["count"] // 3
    return total


def _primitive_triangles(gltf: dict, mesh: dict) -> list[int]:
    return [
        gltf["accessors"][p.get("indices", p["attributes"]["POSITION"])]["count"] // 3 for p in mesh["primitives"]
    ]


def list_parts(path: Path) -> list[dict]:
    """Every node with a mesh, depth-first in scene order (how three.js traverses it)."""
    gltf = read_gltf_json(path)
    nodes = gltf.get("nodes", [])
    scene = gltf["scenes"][gltf.get("scene", 0)]
    parts = []

    def visit(node_index, parent_name):
        node = nodes[node_index]
        name = node.get("name") or None
        if "mesh" in node:
            mesh = gltf["meshes"][node["mesh"]]
            parts.append(
                {
                    "index": len(parts),
                    "name": name or mesh.get("name") or f"Part {len(parts) + 1}",
                    "parent_name": parent_name,
                    "triangle_count": _triangle_count(gltf, mesh),
                    "color": _material_hex(gltf, mesh["primitives"][0].get("material")),
                    # Per primitive, for mapping triangles back to CAD faces (faces.py).
                    "primitive_triangles": _primitive_triangles(gltf, mesh),
                }
            )
        for child in node.get("children", []):
            visit(child, name or parent_name)

    for root in scene.get("nodes", []):
        visit(root, None)
    return parts
