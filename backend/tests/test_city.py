from datetime import date
from types import SimpleNamespace

from fastapi.testclient import TestClient

from lingolife.app import create_app
from lingolife.city import (CITY_LOCATIONS, EVENT_LOCATION_HINTS, HOME_SLOTS,
                            MIN_NPC_DISTANCE, city_payload, daily_location_id)
from lingolife.config import Settings


def profile(name="Maya", occupation="Designer"):
    return {"name": name, "occupation": occupation, "avatar": {"hair": "bob"}}


def test_city_has_typical_places_and_stable_separated_homes():
    profiles = [{"id": f"npc-{index}", "profile": profile(str(index))} for index in range(5)]
    first = city_payload("player-1", profiles, {}, date(2026, 8, 18))
    second = city_payload("player-1", profiles, {}, date(2026, 8, 18))
    assert first == second
    assert first["map"] == {"width": 4800, "height": 3000}
    assert len(CITY_LOCATIONS) >= 30
    assert {place.kind for place in CITY_LOCATIONS} >= {"transit", "work", "health", "park", "civic", "shopping", "cafe", "culture", "education"}
    assert len({(npc["home"]["x"], npc["home"]["y"]) for npc in first["npcs"]}) == 5
    xs = [npc["home"]["x"] for npc in first["npcs"]]
    ys = [npc["home"]["y"] for npc in first["npcs"]]
    assert max(xs) - min(xs) > 2000
    assert max(ys) - min(ys) > 1500
    assert all(0 < x < 4800 and 0 < y < 3000 for x, y in HOME_SLOTS)


def test_home_assignment_does_not_depend_on_profile_order():
    profiles = [{"id": f"npc-{index}", "profile": profile(str(index))} for index in range(5)]
    normal = city_payload("player-1", profiles, {}, date(2026, 8, 18))
    reversed_payload = city_payload("player-1", list(reversed(profiles)), {}, date(2026, 8, 18))
    normal_homes = {npc["id"]: npc["home"] for npc in normal["npcs"]}
    reversed_homes = {npc["id"]: npc["home"] for npc in reversed_payload["npcs"]}
    assert normal_homes == reversed_homes
    normal_positions = {npc["id"]: npc["position"] for npc in normal["npcs"]}
    reversed_positions = {npc["id"]: npc["position"] for npc in reversed_payload["npcs"]}
    assert normal_positions == reversed_positions


def test_characters_are_not_close_on_the_same_day():
    profiles = [
        {"id": f"npc-{index}", "profile": profile(str(index), occupation="Nurse")}
        for index in range(5)
    ]
    for day in range(18, 25):
        payload = city_payload("player-1", profiles, {}, date(2026, 8, day))
        points = [(npc["position"]["x"], npc["position"]["y"]) for npc in payload["npcs"]]
        for index, point in enumerate(points):
            for other in points[index + 1:]:
                distance_squared = (point[0] - other[0]) ** 2 + (point[1] - other[1]) ** 2
                assert distance_squared >= MIN_NPC_DISTANCE ** 2


def test_colliding_events_keep_one_exact_story_location_and_separate_everyone():
    profiles = [{"id": f"npc-{index}", "profile": profile(str(index))} for index in range(5)]
    events = {
        entry["id"]: SimpleNamespace(template_id="daily_library_note")
        for entry in profiles
    }
    payload = city_payload("player-1", profiles, events, date(2026, 8, 18))
    residents = {npc["id"]: npc for npc in payload["npcs"]}
    assert residents["npc-0"]["current_location_id"] == "city_library"
    points = [(npc["position"]["x"], npc["position"]["y"]) for npc in payload["npcs"]]
    for index, point in enumerate(points):
        for other in points[index + 1:]:
            distance_squared = (point[0] - other[0]) ** 2 + (point[1] - other[1]) ** 2
            assert distance_squared >= MIN_NPC_DISTANCE ** 2


def test_daily_plan_drives_location_but_joint_scheduler_still_resolves_collisions():
    profiles = [{"id": f"npc-{index}", "profile": profile(str(index))} for index in range(3)]
    plans = {entry["id"]: "music_hall" for entry in profiles}
    payload = city_payload("player-1", profiles, {}, date(2026, 8, 19), plans)
    residents = {npc["id"]: npc for npc in payload["npcs"]}
    assert residents["npc-0"]["current_location_id"] == "music_hall"
    assert len({(npc["position"]["x"], npc["position"]["y"]) for npc in payload["npcs"]}) == 3


def test_active_event_places_npc_at_related_landmark():
    event = SimpleNamespace(template_id="growth_first_exhibition")
    assert daily_location_id("p", "n", profile(), event, date(2026, 8, 18)) == "community_gallery"
    event = SimpleNamespace(template_id="surprise_found_wallet")
    assert daily_location_id("p", "n", profile(), event, date(2026, 8, 18)) == "police_station"
    event = SimpleNamespace(template_id="relationship_roommate_conflict")
    assert daily_location_id("p", "n", profile(), event, date(2026, 8, 18)) is None
    known = {location.id for location in CITY_LOCATIONS}
    assert set(EVENT_LOCATION_HINTS.values()) <= known | {None}


def test_daily_schedule_is_deterministic_and_uses_known_location_or_home():
    known = {location.id for location in CITY_LOCATIONS}
    values = [daily_location_id("p", "n", profile(occupation="Nurse"), None, date(2026, 8, day))
              for day in range(18, 25)]
    assert values == [daily_location_id("p", "n", profile(occupation="Nurse"), None, date(2026, 8, day))
                      for day in range(18, 25)]
    assert set(values) <= known | {None}
    assert len(set(values)) > 1


def test_weekday_profession_and_weekend_interests_shape_schedule():
    known = {location.id for location in CITY_LOCATIONS}
    nurse_weekdays = [daily_location_id("p", "nurse", profile(occupation="Nurse"), None, date(2026, 8, day))
                      for day in range(3, 8)]
    assert set(nurse_weekdays) <= {"city_hospital", "moonlight_cafe", "sunny_plaza", None}
    assert "city_hospital" in nurse_weekdays
    reader = {**profile(occupation="Nurse"), "interests": ["books", "reading"]}
    weekend_values = [daily_location_id("p", "reader", reader, None, date(2026, 8, day))
                      for day in (1, 2, 8, 9, 15, 16, 22, 23)]
    assert set(weekend_values) <= known | {None}
    assert "city_hospital" not in weekend_values
    assert "maple_bookshop" in weekend_values


def test_city_api_requires_auth_and_includes_event_summary(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'city.db'}", web_root=str(tmp_path / "none"))
    client = TestClient(create_app(settings))
    assert client.get("/api/v1/city").status_code == 401
    code = client.app.state.db.create_invites(1, 30)[0]
    registration = client.post("/api/v1/auth/register", json={"username": "cityuser", "invite_code": code, "password": "city-pass"}).json()
    headers = {"Authorization": "Bearer " + registration["session_token"]}
    response = client.get("/api/v1/city", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["npcs"][0]["id"] == "emma"
    assert body["npcs"][0]["name"] == "Emma"
    assert body["npcs"][0]["active_event"]["stage_count"] == 3
    resident = body["npcs"][0]
    assert resident["is_home"] or any(place["id"] == resident["current_location_id"] for place in body["locations"])
