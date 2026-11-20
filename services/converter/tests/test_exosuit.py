import pytest

from holocad_converter.convert import convert_step_to_glb
from holocad_converter.exosuit import SUIT_NAME, write_exosuit_step
from holocad_converter.glb import read_gltf_json


@pytest.fixture(scope="module")
def exosuit(tmp_path_factory):
    folder = tmp_path_factory.mktemp("exosuit")
    step = write_exosuit_step(folder / "sentinel.step")
    return convert_step_to_glb(step, folder / "sentinel.glb", "draft")


def test_every_part_has_a_real_name(exosuit):
    assert exosuit.part_count == 32
    names = [p["name"] for p in exosuit.parts]
    # No OCCT placeholders like "=>[0:1:1:3]" leak into labels.
    assert not [n for n in names if n.startswith("=>")]
    assert names.count("Gauntlet") == 2
    assert {"Helmet", "Visor", "Chest core", "Left thruster", "Abdomen segment 3"} <= set(names)


def test_left_and_right_limbs_are_told_apart_by_parent(exosuit):
    parents = {}
    for part in exosuit.parts:
        parents.setdefault(part["parent_name"], []).append(part["name"])
    assert set(parents) == {"Head", "Torso", "Left arm", "Right arm", "Left leg", "Right leg"}
    assert parents["Left arm"] == parents["Right arm"]
    assert parents["Left leg"] == ["Boot", "Shin guard", "Knee guard", "Thigh plate"]


def test_suit_is_human_sized_and_standing(exosuit):
    (x0, y0, z0), (x1, y1, z1) = exosuit.bounds["min"], exosuit.bounds["max"]
    assert y0 == pytest.approx(0.0, abs=1e-3)  # feet on the floor
    assert 1.7 < y1 - y0 < 1.9  # metres tall, Y up
    assert x1 - x0 < 1.0 and z1 - z0 < 0.6


def test_root_node_is_the_suit(exosuit, tmp_path):
    gltf = read_gltf_json(exosuit.output_path)
    roots = [gltf["nodes"][i].get("name") for i in gltf["scenes"][0]["nodes"]]
    assert roots == [SUIT_NAME]
