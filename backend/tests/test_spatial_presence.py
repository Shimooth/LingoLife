from datetime import datetime, timezone

import pytest

from lingolife.db import Database
from lingolife.life_service import LifeWorldService
from lingolife.spatial_presence import spatial_presence, INDOOR_LOCATIONS


def presence(current, target=None, status="performing"):
    return spatial_presence(current_location_id=current, target_location_id=target or current,
                            status=status, home_location_id="home-1", household_id="shared")


@pytest.mark.parametrize("place", sorted(INDOOR_LOCATIONS) + ["home-1", "shared:kitchen:stove", "shared:private-bedroom:bed"])
def test_confirmed_interiors_are_not_street_actors(place):
    assert presence(place)["mode"] == "indoor"
    assert ":" not in presence(place)["building_id"]  # No private room disclosure.


@pytest.mark.parametrize("place", ["sunny_plaza", "riverside_park", "canal_walk", "old_town_market", "city_university", "city_stadium", "unknown-site"])
def test_open_air_mixed_and_unknown_places_are_not_assumed_indoors(place):
    assert presence(place) == {"mode":"outdoor", "location_id":place, "building_id":None}


def test_planning_is_not_leaving_and_indoor_room_walks_stay_inside():
    assert presence("shared:kitchen:stove", "city_library", "planned")["mode"] == "indoor"
    assert presence("shared:kitchen:stove", "shared:living-room:sofa", "traveling")["mode"] == "indoor"
    assert presence("home-1", "shared:kitchen:stove", "traveling")["mode"] == "indoor"


@pytest.mark.parametrize("origin,target", [("shared:kitchen:stove","city_library"), ("city_library","shared:kitchen:stove"), ("city_library","moonlight_cafe")])
def test_journeys_are_visible_until_authoritative_arrival(origin, target):
    assert presence(origin,target,"traveling")["mode"] == "traveling"
    assert presence(target,target,"performing")["mode"] == "indoor"


def test_city_api_projects_real_current_position_and_private_room_safely(tmp_path, monkeypatch):
    service = LifeWorldService(Database(f"sqlite:///{tmp_path / 'presence.db'}"), "UTC")
    now = datetime(2026, 9, 6, 8, tzinfo=timezone.utc)
    entries = [{"id":"ava","profile":{"name":"Ava"}}, {"id":"bo","profile":{"name":"Bo"}}]
    state = service.load("presence-test",entries,now=now)
    monkeypatch.setattr(service,"load",lambda *args,**kwargs:state)
    resident = state["residents"]["ava"]
    home, household = resident["home_location_id"], resident["household_id"]
    action = resident["current_action"]
    resident["current_location_id"] = f"{household}:kitchen:stove"
    action.update({"action_type":"prepare_food","status":"performing","location_id":resident["current_location_id"]})
    def dto():
        return next(item for item in service.city("presence-test",entries,now=now)["npcs"] if item["id"]=="ava")
    assert dto()["spatial_presence"] == {"mode":"indoor","location_id":home,"building_id":home}
    assert dto()["current_room_id"] == "kitchen"
    action.update({"status":"traveling","location_id":"city_library"})
    assert dto()["spatial_presence"]["mode"] == "traveling"
    assert dto()["current_room_id"] is None
    resident["current_location_id"] = "city_library"
    action["status"] = "performing"
    assert dto()["spatial_presence"]["building_id"] == "city_library"
    resident["current_location_id"] = f"{household}:private-bedroom:bed"
    action.update({"action_type":"sleep","location_id":resident["current_location_id"]})
    assert dto()["current_room_id"] == "bedroom"
    assert dto()["spatial_presence"]["building_id"] == home
