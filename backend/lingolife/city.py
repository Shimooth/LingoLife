from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from datetime import date
from typing import Sequence


@dataclass(frozen=True)
class CityLocation:
    id: str
    name: str
    kind: str
    x: int
    y: int
    district: str


# Coordinates live in a stable, UI-independent 1600 x 1000 world space.
CITY_LOCATIONS: tuple[CityLocation, ...] = (
    CityLocation("central_station", "Central Station", "transit", 790, 115, "North Gate"),
    CityLocation("business_center", "Business Center", "work", 1110, 205, "North Gate"),
    CityLocation("city_hospital", "City Hospital", "health", 1380, 330, "Eastside"),
    CityLocation("riverside_park", "Riverside Park", "park", 1240, 610, "Eastside"),
    CityLocation("police_station", "Police Station", "civic", 1390, 785, "Eastside"),
    CityLocation("old_town_market", "Old Town Market", "shopping", 890, 800, "Old Town"),
    CityLocation("moonlight_cafe", "Moonlight Café", "cafe", 650, 690, "Old Town"),
    CityLocation("community_gallery", "Community Gallery", "culture", 470, 790, "Old Town"),
    CityLocation("city_library", "City Library", "education", 315, 605, "West End"),
    CityLocation("community_school", "Community School", "education", 180, 380, "West End"),
    CityLocation("neighborhood_clinic", "Neighborhood Clinic", "health", 425, 310, "West End"),
    CityLocation("sunny_plaza", "Sunny Plaza", "plaza", 760, 430, "Central"),
    CityLocation("greenway_gym", "Greenway Gym", "fitness", 1030, 490, "Central"),
)

LOCATION_BY_ID = {location.id: location for location in CITY_LOCATIONS}

# Five separated lots, matching the current per-account character limit.
HOME_SLOTS: tuple[tuple[int, int], ...] = (
    (180, 820), (285, 875), (390, 920), (1185, 875), (1320, 915),
)

EVENT_LOCATION_HINTS = {
    "daily_burnt_breakfast": "moonlight_cafe",
    "daily_rainy_walk": "riverside_park",
    "daily_mystery_package": "sunny_plaza",
    "growth_rejected_design": "business_center",
    "growth_first_exhibition": "community_gallery",
    "growth_interview_tomorrow": "business_center",
    "relationship_forgot_birthday": "moonlight_cafe",
    "relationship_old_friend_message": "riverside_park",
    "surprise_found_wallet": "police_station",
    "daily_library_note": "city_library",
    "daily_open_mic": "moonlight_cafe",
    "growth_difficult_student": "community_school",
    "growth_exhausting_shift": "city_hospital",
    "relationship_family_call": "riverside_park",
    "surprise_train_delay": "central_station",
}

CATEGORY_LOCATIONS = {
    "daily": ("moonlight_cafe", "old_town_market", "riverside_park", "sunny_plaza"),
    "growth": ("business_center", "city_library", "community_gallery", "community_school"),
    "relationship": ("moonlight_cafe", "riverside_park", "sunny_plaza"),
    "surprise": ("central_station", "old_town_market", "riverside_park", "sunny_plaza"),
}


def _number(*parts: str) -> int:
    raw = "\x1f".join(parts).encode("utf-8")
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "big")


def home_slot(player_id: str, npc_id: str, occupied: set[int] | None = None) -> int:
    """Return a stable lot, resolving the rare hash collision within one city response."""
    occupied = occupied if occupied is not None else set()
    start = _number("home", player_id, npc_id) % len(HOME_SLOTS)
    for offset in range(len(HOME_SLOTS)):
        candidate = (start + offset) % len(HOME_SLOTS)
        if candidate not in occupied:
            occupied.add(candidate)
            return candidate
    return start


def daily_location_id(player_id: str, npc_id: str, profile: dict, active_event,
                      on_date: date | None = None) -> str | None:
    """Choose today's location deterministically; None represents the NPC's own home."""
    day = on_date or date.today()
    if active_event:
        hinted = EVENT_LOCATION_HINTS.get(active_event.template_id)
        if hinted:
            return hinted
        category = active_event.template_id.split("_", 1)[0]
        choices = CATEGORY_LOCATIONS.get(category)
        if choices:
            return choices[_number("event", day.isoformat(), player_id, npc_id) % len(choices)]

    occupation = str(profile.get("occupation", "")).casefold()
    workplace = "city_hospital" if any(word in occupation for word in ("doctor", "nurse", "medical")) else \
        "community_school" if any(word in occupation for word in ("teacher", "student", "professor")) else \
        "community_gallery" if any(word in occupation for word in ("artist", "designer", "photograph")) else \
        "moonlight_cafe" if any(word in occupation for word in ("barista", "chef", "cook")) else \
        "business_center"
    choices: tuple[str | None, ...]
    if day.weekday() < 5:
        choices = (workplace, workplace, "moonlight_cafe", "sunny_plaza", None)
    else:
        choices = ("riverside_park", "old_town_market", "moonlight_cafe", "city_library", None)
    return choices[_number("schedule", day.isoformat(), player_id, npc_id) % len(choices)]


def city_payload(player_id: str, profiles: Sequence[dict], active_events: dict[str, object],
                 on_date: date | None = None) -> dict:
    day = on_date or date.today()
    occupied: set[int] = set()
    residents = []
    for entry in profiles:
        npc_id, profile = entry["id"], entry["profile"]
        slot = home_slot(player_id, npc_id, occupied)
        home_x, home_y = HOME_SLOTS[slot]
        active = active_events.get(npc_id)
        location_id = daily_location_id(player_id, npc_id, profile, active, day)
        location = LOCATION_BY_ID.get(location_id) if location_id else None
        residents.append({
            "id": npc_id,
            "name": profile.get("name", "Character"),
            "avatar": profile.get("avatar", {}),
            "home": {"id": f"home-{slot + 1}", "x": home_x, "y": home_y},
            "current_location_id": location_id or f"home-{slot + 1}",
            "position": {"x": location.x if location else home_x, "y": location.y if location else home_y},
            "is_home": location is None,
        })
    return {
        "date": day.isoformat(),
        "map": {"width": 1600, "height": 1000},
        "locations": [asdict(location) for location in CITY_LOCATIONS],
        "npcs": residents,
    }
