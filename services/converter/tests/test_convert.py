import pytest

from holocad_converter.convert import ConversionError, convert_step_to_glb
from holocad_converter.glb import read_gltf_json
from holocad_converter.sample import INSTANCE_COUNT, PART_NAMES


def test_converts_sample_with_names_colours_and_instances(sample_step, tmp_path):
    out = tmp_path / "gearbox.glb"
    result = convert_step_to_glb(sample_step, out)

    assert out.read_bytes()[:4] == b"glTF"
    assert result.glb_bytes == out.stat().st_size
    assert result.part_count == INSTANCE_COUNT
    assert sorted({p["name"] for p in result.parts}) == sorted(PART_NAMES)
    assert [p["name"] for p in result.parts].count("Bearing block") == 2
    assert all(p["triangle_count"] > 0 for p in result.parts)
    assert result.triangle_count == sum(p["triangle_count"] for p in result.parts)
    assert all(p["color"] and p["color"].startswith("#") for p in result.parts)
    assert {p["parent_name"] for p in result.parts} == {"Mini gearbox"}


def test_bounds_are_metres_and_y_up(sample_step, tmp_path):
    result = convert_step_to_glb(sample_step, tmp_path / "gearbox.glb")
    (x0, y0, z0), (x1, y1, z1) = result.bounds["min"], result.bounds["max"]
    # Sample is 140 × 80 mm on the floor and 50 mm tall (Z-up in CAD).
    assert result.bounds["units"] == "m"
    assert x1 - x0 == pytest.approx(0.140, abs=1e-3)
    assert z1 - z0 == pytest.approx(0.080, abs=1e-3)
    assert y1 - y0 == pytest.approx(0.050, abs=1e-3)
    assert y0 == pytest.approx(0.0, abs=1e-6)


def test_finer_quality_means_more_triangles(sample_step, tmp_path):
    draft = convert_step_to_glb(sample_step, tmp_path / "draft.glb", "draft")
    fine = convert_step_to_glb(sample_step, tmp_path / "fine.glb", "fine")
    assert fine.triangle_count > draft.triangle_count


def test_glb_nodes_are_named_after_parts(sample_step, tmp_path):
    out = tmp_path / "gearbox.glb"
    convert_step_to_glb(sample_step, out)
    names = {node.get("name") for node in read_gltf_json(out)["nodes"]}
    assert set(PART_NAMES) <= names


def test_rejects_non_step_file(tmp_path):
    bogus = tmp_path / "notes.step"
    bogus.write_text("just some text")
    with pytest.raises(ConversionError, match="doesn't look like a STEP file"):
        convert_step_to_glb(bogus, tmp_path / "out.glb")
    assert not (tmp_path / "out.glb").exists()


def test_rejects_truncated_step(sample_step, tmp_path):
    broken = tmp_path / "broken.step"
    broken.write_bytes(sample_step.read_bytes()[:2000])
    with pytest.raises(ConversionError):
        convert_step_to_glb(broken, tmp_path / "out.glb")
    assert not (tmp_path / "out.glb").exists()
    assert not (tmp_path / "out.glb.partial").exists()
