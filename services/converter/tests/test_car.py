from collections import Counter

import pytest

from holocad_converter.car import CAR_NAME, write_car_step
from holocad_converter.convert import convert_step_to_glb
from holocad_converter.glb import read_gltf_json

CORNERS = {"Front left corner", "Front right corner", "Rear left corner", "Rear right corner"}


@pytest.fixture(scope="module")
def car(tmp_path_factory):
    # Generating the car takes ~30 s, so the whole module shares one build.
    folder = tmp_path_factory.mktemp("car")
    step = write_car_step(folder / "aster.step")
    return convert_step_to_glb(step, folder / "aster.glb", "draft")


def test_part_count_and_real_names(car):
    assert car.part_count == 118
    names = [p["name"] for p in car.parts]
    # No OCCT placeholders like "=>[0:1:1:3]" leak into labels.
    assert not [n for n in names if "=>" in n]
    assert {"Windshield", "Hood", "Engine block", "Gearbox", "Driver seat", "Brake disc"} <= set(names)


def test_product_structure(car):
    by_parent = Counter(p["parent_name"] for p in car.parts)
    assert {"Body", "Chassis", "Powertrain", "Interior", "Wheel"} | CORNERS == set(by_parent)
    assert by_parent["Wheel"] == 4 * 8  # rim, tyre, cap, 5 lug nuts, on four wheels
    assert all(by_parent[c] == 7 for c in CORNERS)


def test_placed_instances_keep_their_own_names(car):
    names = [p["name"] for p in car.parts]
    for pair in (("Left frame rail", "Right frame rail"), ("Left mirror", "Right mirror"), ("Driver seat", "Passenger seat")):
        assert all(names.count(n) == 1 for n in pair)
    assert names.count("Lug nut 5") == 4


def test_car_is_full_size_on_the_ground(car):
    (x0, y0, z0), (x1, y1, z1) = car.bounds["min"], car.bounds["max"]
    assert y0 == pytest.approx(0.0, abs=1e-3)  # tyres on the ground, Y up
    assert 4.1 < z1 - z0 < 4.3  # length, metres
    assert 1.8 < x1 - x0 < 2.1  # width over mirrors
    assert 1.35 < y1 - y0 < 1.5  # height


def test_root_node_is_the_car(car):
    gltf = read_gltf_json(car.output_path)
    roots = [gltf["nodes"][i].get("name") for i in gltf["scenes"][0]["nodes"]]
    assert roots == [CAR_NAME]


def test_every_part_has_measured_specs_and_a_material(car):
    specs = {p["name"]: p["spec"] for p in car.parts}
    assert all(p.get("spec") for p in car.parts)
    assert all(s["mass_kg"] for s in specs.values())
    block = specs["Engine block"]
    assert block["material"]["name"] == "Aluminium A356 cast"
    assert block["features"]["holes"] == [{"diameter": 80.0, "depth": 250.0, "count": 4}]  # cylinder bores
    disc = specs["Brake disc"]
    assert disc["overall_size_mm"] == pytest.approx([320, 320, 26], abs=0.01)
    assert disc["features"]["holes"] == [{"diameter": 120.0, "depth": 26.0, "count": 1}]


def test_placed_copies_share_specs_but_not_position(car):
    discs = [p["spec"] for p in car.parts if p["name"] == "Brake disc"]
    assert len(discs) == 4
    assert len({d["volume_mm3"] for d in discs}) == 1
    assert len({tuple(d["centre_of_mass_m"]) for d in discs}) == 4
