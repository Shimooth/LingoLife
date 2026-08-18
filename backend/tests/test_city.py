from datetime import date
from types import SimpleNamespace

from fastapi.testclient import TestClient

from lingolife.app import create_app
from lingolife.city import CITY_LOCATIONS, city_payload, daily_location_id
from lingolife.config import Settings


def profile(name="Maya", occupation="Designer"):
    return {"name": name, "occupation": occupation, "avatar": {"hair": "bob"}}


def test_city_has_typical_places_and_stable_separated_homes():
    profiles = [{"id": f"npc-{index}", "profile": profile(str(index))} for index in range(5)]
    first = city_payload("player-1", profiles, {}, date(2026, 8, 18))
    second = city_payload("player-1", profiles, {}, date(2026, 8, 18))
    assert first == second
    assert first["map"] == {"width": 1600, "height": 1000}
    assert {place.kind for place in CITY_LOCATIONS} >= {"transit", "work", "health", "park", "civic", "shopping", "cafe", "culture", "education"}
    assert len({(npc["home"]["x"], npc["home"]["y"]) for npc in first["npcs"]}) == 5


def test_active_event_places_npc_at_related_landmark():
    event = SimpleNamespace(template_id="growth_first_exhibition")
    assert daily_location_id("p", "n", profile(), event, date(2026, 8, 18)) == "community_gallery"
    event = SimpleNamespace(template_id="surprise_found_wallet")
    assert daily_location_id("p", "n", profile(), event, date(2026, 8, 18)) == "police_station"


def test_daily_schedule_is_deterministic_and_uses_known_location_or_home():
    known = {location.id for location in CITY_LOCATIONS}
    values = [daily_location_id("p", "n", profile(occupation="Nurse"), None, date(2026, 8, day))
              for day in range(18, 25)]
    assert values == [daily_location_id("p", "n", profile(occupation="Nurse"), None, date(2026, 8, day))
                      for day in range(18, 25)]
    assert set(values) <= known | {None}
    assert len(set(values)) > 1


def test_city_api_requires_auth_and_includes_event_summary(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'city.db'}", web_root=str(tmp_path / "none"))
    client = TestClient(create_app(settings))
    assert client.get("/api/v1/city").status_code == 401
    code = client.app.state.db.create_invites(1, 30)[0]
    registration = client.post("/api/v1/auth/register", json={"username": "cityuser", "invite_code": code}).json()
    headers = {"Authorization": "Bearer " + registration["session_token"]}
    response = client.get("/api/v1/city", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["npcs"][0]["id"] == "emma"
    assert body["npcs"][0]["name"] == "Emma"
    assert body["npcs"][0]["active_event"]["stage_count"] == 3
    assert any(place["id"] == body["npcs"][0]["current_location_id"] for place in body["locations"])
