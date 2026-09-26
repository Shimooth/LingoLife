"""Keep the browser's account-free city art fixture faithful to the server map."""
import json
from pathlib import Path

from lingolife.layouts import default_world_layout


def test_streetscape_fixture_matches_default_city_geometry():
    fixture_path = Path(__file__).resolve().parents[2] / "web/scripts/fixtures/city-published-layout.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert fixture["layout"]["city"] == default_world_layout()["city"]
