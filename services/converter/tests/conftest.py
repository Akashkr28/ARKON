import pytest

from holocad_converter.sample import write_sample_step


@pytest.fixture(scope="session")
def sample_step(tmp_path_factory):
    return write_sample_step(tmp_path_factory.mktemp("samples") / "mini-gearbox.step")


@pytest.fixture
def storage(tmp_path, monkeypatch):
    """A throwaway STORAGE_DIR for API tests."""
    monkeypatch.setenv("STORAGE_DIR", str(tmp_path))
    (tmp_path / "uploads").mkdir()
    return tmp_path
