import shutil

import pytest
from fastapi.testclient import TestClient

from holocad_converter.app import app
from holocad_converter.storage import UnsafePathError, resolve_inside

client = TestClient(app)


def test_health(storage):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["storage"] == str(storage.resolve())


def test_convert_round_trip(storage, sample_step):
    shutil.copy(sample_step, storage / "uploads" / "abc.step")
    res = client.post(
        "/convert",
        json={
            "input_path": "uploads/abc.step",
            "output_path": "models/abc.glb",
            "quality": "draft",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["part_count"] == 7
    assert (storage / "models" / "abc.glb").is_file()


@pytest.mark.parametrize(
    "input_path",
    ["../outside.step", "/etc/passwd", "uploads/../../outside.step", ""],
)
def test_refuses_paths_outside_storage(storage, input_path):
    res = client.post("/convert", json={"input_path": input_path, "output_path": "models/x.glb"})
    assert res.status_code == 400


def test_missing_input_is_404(storage):
    res = client.post(
        "/convert", json={"input_path": "uploads/nope.step", "output_path": "models/x.glb"}
    )
    assert res.status_code == 404


def test_bad_step_is_422_with_readable_message(storage):
    (storage / "uploads" / "bad.step").write_text("hello")
    res = client.post(
        "/convert", json={"input_path": "uploads/bad.step", "output_path": "models/bad.glb"}
    )
    assert res.status_code == 422
    assert "STEP" in res.json()["detail"]


def test_output_must_be_glb(storage, sample_step):
    shutil.copy(sample_step, storage / "uploads" / "a.step")
    res = client.post(
        "/convert", json={"input_path": "uploads/a.step", "output_path": "models/a.txt"}
    )
    assert res.status_code == 400


def test_unknown_quality_is_rejected(storage):
    res = client.post(
        "/convert",
        json={"input_path": "uploads/a.step", "output_path": "models/a.glb", "quality": "ultra"},
    )
    assert res.status_code == 422


def test_resolve_inside_allows_nested_paths(tmp_path):
    assert resolve_inside(tmp_path, "models/a/b.glb") == (tmp_path / "models/a/b.glb").resolve()
    with pytest.raises(UnsafePathError):
        resolve_inside(tmp_path, "models/../../x")
