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


# Stable UI-independent coordinates in a 4800 x 3000 world. Existing landmark
# IDs are retained so older clients and saved event links remain compatible.
CITY_LOCATIONS: tuple[CityLocation, ...] = (
    CityLocation("central_station", "Central Station", "transit", 2380, 250, "North Gate"),
    CityLocation("north_bus_terminal", "North Bus Terminal", "transit", 1150, 230, "North Gate"),
    CityLocation("airport_express", "Airport Express", "transit", 4020, 300, "North Gate"),
    CityLocation("business_center", "Business Center", "work", 3230, 530, "North Gate"),
    CityLocation("innovation_hub", "Innovation Hub", "work", 3760, 690, "North Gate"),
    CityLocation("design_studio", "Canal Design Studio", "work", 2860, 810, "Canal Quarter"),
    CityLocation("city_hospital", "City Hospital", "health", 4260, 970, "Eastside"),
    CityLocation("neighborhood_clinic", "Neighborhood Clinic", "health", 950, 920, "West End"),
    CityLocation("animal_shelter", "City Animal Shelter", "health", 4420, 1840, "Eastside"),
    CityLocation("riverside_park", "Riverside Park", "park", 3890, 1780, "Eastside"),
    CityLocation("botanical_garden", "Botanical Garden", "park", 1050, 1730, "West End"),
    CityLocation("hilltop_park", "Hilltop Park", "park", 790, 390, "North Gate"),
    CityLocation("police_station", "Police Station", "civic", 4210, 2420, "Eastside"),
    CityLocation("city_hall", "City Hall", "civic", 2430, 1230, "Central"),
    CityLocation("fire_station", "Fire Station", "civic", 570, 1310, "West End"),
    CityLocation("community_center", "Community Center", "civic", 3530, 2470, "Southbank"),
    CityLocation("old_town_market", "Old Town Market", "shopping", 2680, 2410, "Old Town"),
    CityLocation("harbor_mall", "Harbor Mall", "shopping", 4200, 2700, "Southbank"),
    CityLocation("maple_bookshop", "Maple Bookshop", "shopping", 1510, 2230, "Old Town"),
    CityLocation("moonlight_cafe", "Moonlight Café", "cafe", 2070, 2130, "Old Town"),
    CityLocation("garden_cafe", "Garden Café", "cafe", 1150, 2000, "West End"),
    CityLocation("harbor_restaurant", "Harbor Restaurant", "restaurant", 3660, 2770, "Southbank"),
    CityLocation("community_gallery", "Community Gallery", "culture", 1650, 2500, "Old Town"),
    CityLocation("city_museum", "City Museum", "culture", 2120, 1460, "Central"),
    CityLocation("aurora_theater", "Aurora Theater", "culture", 2890, 1510, "Central"),
    CityLocation("music_hall", "Southbank Music Hall", "culture", 3160, 2640, "Southbank"),
    CityLocation("city_library", "City Library", "education", 1200, 1420, "West End"),
    CityLocation("community_school", "Community School", "education", 560, 750, "West End"),
    CityLocation("city_university", "City University", "education", 1760, 550, "North Gate"),
    CityLocation("sunny_plaza", "Sunny Plaza", "plaza", 2430, 1770, "Central"),
    CityLocation("canal_square", "Canal Square", "plaza", 3160, 1170, "Canal Quarter"),
    CityLocation("greenway_gym", "Greenway Gym", "fitness", 3050, 1840, "Central"),
    CityLocation("city_stadium", "City Stadium", "fitness", 650, 2660, "Southwest"),
    CityLocation("canal_walk", "Canal Walk", "waterfront", 3480, 1410, "Canal Quarter"),
    CityLocation("south_harbor", "South Harbor", "waterfront", 3420, 2890, "Southbank"),
    CityLocation("co_working_loft", "Old Town Co-working Loft", "work", 2340, 2650, "Old Town"),
)

LOCATION_BY_ID = {location.id: location for location in CITY_LOCATIONS}

# Lots span several residential neighborhoods. There are substantially more
# slots than the five-character cap, so homes feel city-wide and personal.
HOME_SLOTS: tuple[tuple[int, int], ...] = (
    (330, 410), (490, 480), (690, 530), (870, 610),
    (1280, 350), (1470, 360), (1960, 310), (2150, 470),
    (4050, 520), (4320, 600), (4520, 750), (3980, 820),
    (310, 1710), (500, 1850), (720, 2020), (890, 2210),
    (3930, 1280), (4210, 1420), (4490, 1540), (4050, 1580),
    (380, 2250), (520, 2420), (900, 2350), (1110, 2570),
    (1320, 2740), (1540, 2830), (1870, 2740), (2070, 2860),
    (2740, 2800), (2980, 2880), (3890, 2350), (4450, 2250),
)

EVENT_LOCATION_HINTS: dict[str, str | None] = {
    "daily_burnt_breakfast": "moonlight_cafe",
    "daily_rainy_walk": "riverside_park",
    "daily_mystery_package": "sunny_plaza",
    "daily_library_note": "city_library",
    "daily_open_mic": "music_hall",
    "growth_rejected_design": "design_studio",
    "growth_first_exhibition": "community_gallery",
    "growth_interview_tomorrow": "business_center",
    "growth_difficult_student": "community_school",
    "growth_exhausting_shift": "city_hospital",
    "relationship_forgot_birthday": "moonlight_cafe",
    "relationship_roommate_conflict": None,
    "relationship_old_friend_message": "riverside_park",
    "relationship_family_call": "canal_walk",
    "surprise_lost_dog": "animal_shelter",
    "surprise_power_cut": "community_center",
    "surprise_found_wallet": "police_station",
    "surprise_train_delay": "central_station",
}

CATEGORY_LOCATIONS = {
    "daily": ("moonlight_cafe", "old_town_market", "riverside_park", "sunny_plaza", "city_library"),
    "growth": ("business_center", "innovation_hub", "city_library", "community_gallery", "city_university"),
    "relationship": ("moonlight_cafe", "riverside_park", "canal_walk", "sunny_plaza"),
    "surprise": ("central_station", "old_town_market", "riverside_park", "south_harbor", "sunny_plaza"),
}

# Character markers should remain visually distinct on the city map. These five
# landmarks are more than twice the minimum distance apart, so with the current
# five-character cap there is always a collision-free deterministic fallback.
MIN_NPC_DISTANCE = 600
SEPARATION_ANCHORS: tuple[str, ...] = (
    "north_bus_terminal",
    "airport_express",
    "animal_shelter",
    "city_stadium",
    "harbor_restaurant",
)


def _number(*parts: str) -> int:
    raw = "\x1f".join(parts).encode("utf-8")
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "big")


def home_slot(player_id: str, npc_id: str, occupied: set[int] | None = None) -> int:
    """Return a repeatable lot and deterministically resolve collisions."""
    occupied = occupied if occupied is not None else set()
    start = _number("home", player_id, npc_id) % len(HOME_SLOTS)
    step = 7  # coprime to 32, so every slot is visited before repeating
    for offset in range(len(HOME_SLOTS)):
        candidate = (start + offset * step) % len(HOME_SLOTS)
        if candidate not in occupied:
            occupied.add(candidate)
            return candidate
    return start


def _home_assignments(player_id: str, npc_ids: Sequence[str]) -> dict[str, int]:
    """Assignment is stable even if DB/API profile ordering changes."""
    occupied: set[int] = set()
    return {npc_id: home_slot(player_id, npc_id, occupied) for npc_id in sorted(npc_ids)}


def _workplace(profile: dict) -> str:
    occupation = str(profile.get("occupation", "")).casefold()
    rules = (
        (("doctor", "nurse", "medical", "therapist"), "city_hospital"),
        (("veterinarian", "animal", "pet"), "animal_shelter"),
        (("teacher", "tutor", "school"), "community_school"),
        (("student", "professor", "research"), "city_university"),
        (("artist", "curator"), "community_gallery"),
        (("designer", "architect", "fashion"), "design_studio"),
        (("photograph", "filmmaker"), "community_gallery"),
        (("barista", "baker"), "moonlight_cafe"),
        (("chef", "cook", "restaurant"), "harbor_restaurant"),
        (("writer", "editor", "librarian"), "city_library"),
        (("developer", "engineer", "technology", "scientist"), "innovation_hub"),
        (("police", "officer"), "police_station"),
        (("trainer", "athlete", "fitness"), "greenway_gym"),
        (("shop", "retail", "sales"), "old_town_market"),
    )
    return next((place for words, place in rules if any(word in occupation for word in words)), "business_center")


def _leisure_places(profile: dict) -> tuple[str, ...]:
    interests = " ".join(str(value).casefold() for value in profile.get("interests", ()))
    result: list[str] = []
    mappings = (
        (("book", "read", "writing"), "maple_bookshop"),
        (("art", "paint", "photograph"), "city_museum"),
        (("music", "theater", "film"), "music_hall"),
        (("fitness", "sport", "running"), "greenway_gym"),
        (("nature", "garden", "animal"), "botanical_garden"),
        (("cook", "food", "coffee"), "old_town_market"),
        (("technology", "gaming"), "innovation_hub"),
    )
    for words, location in mappings:
        if any(word in interests for word in words):
            result.append(location)
    return tuple(result) or ("riverside_park", "old_town_market", "moonlight_cafe", "city_library")


def daily_location_id(player_id: str, npc_id: str, profile: dict, active_event,
                      on_date: date | None = None) -> str | None:
    """Choose today's location deterministically; None represents the NPC's home."""
    day = on_date or date.today()
    if active_event:
        if active_event.template_id in EVENT_LOCATION_HINTS:
            return EVENT_LOCATION_HINTS[active_event.template_id]
        category = active_event.template_id.split("_", 1)[0]
        choices = CATEGORY_LOCATIONS.get(category)
        if choices:
            return choices[_number("event", day.isoformat(), player_id, npc_id) % len(choices)]

    if day.weekday() < 5:
        workplace = _workplace(profile)
        choices: tuple[str | None, ...] = (workplace, workplace, workplace, "moonlight_cafe", "sunny_plaza", None)
    else:
        leisure = _leisure_places(profile)
        choices = (*leisure, "riverside_park", "old_town_market", "canal_walk", None)
    return choices[_number("schedule", day.isoformat(), player_id, npc_id) % len(choices)]


def _rotated(values: Sequence[str], offset: int) -> tuple[str, ...]:
    if not values:
        return ()
    start = offset % len(values)
    return tuple(values[start:]) + tuple(values[:start])


def _location_candidates(player_id: str, npc_id: str, profile: dict, active_event,
                         day: date) -> tuple[str | None, ...]:
    """Return a preference-ordered, deterministic schedule for one NPC."""
    preferred = daily_location_id(player_id, npc_id, profile, active_event, day)
    seed = _number("location-candidates", day.isoformat(), player_id, npc_id)
    candidates: list[str | None] = [preferred]

    if active_event:
        category = active_event.template_id.split("_", 1)[0]
        candidates.extend(_rotated(CATEGORY_LOCATIONS.get(category, ()), seed))
    elif day.weekday() < 5:
        candidates.extend((_workplace(profile), "moonlight_cafe", "sunny_plaza", None))
    else:
        candidates.extend(_rotated(_leisure_places(profile), seed))
        candidates.extend(("riverside_park", "old_town_market", "canal_walk", None))

    # Fallbacks are deliberately city-wide. Their pairwise spacing guarantees a
    # free point for every character even when several preferred places collide.
    candidates.extend(_rotated(SEPARATION_ANCHORS, seed))
    candidates.extend(_rotated(tuple(LOCATION_BY_ID), seed))
    candidates.append(None)
    return tuple(dict.fromkeys(candidates))


def _coordinates(location_id: str | None, home: tuple[int, int]) -> tuple[int, int]:
    location = LOCATION_BY_ID.get(location_id) if location_id else None
    return (location.x, location.y) if location else home


def _far_enough(point: tuple[int, int], occupied: Sequence[tuple[int, int]]) -> bool:
    minimum_squared = MIN_NPC_DISTANCE * MIN_NPC_DISTANCE
    return all((point[0] - other[0]) ** 2 + (point[1] - other[1]) ** 2 >= minimum_squared
               for other in occupied)


def _nearest_distance_squared(point: tuple[int, int], occupied: Sequence[tuple[int, int]]) -> float:
    return min(
        ((point[0] - other[0]) ** 2 + (point[1] - other[1]) ** 2 for other in occupied),
        default=float("inf"),
    )


def _daily_assignments(player_id: str, profiles: Sequence[dict], active_events: dict[str, object],
                       homes: dict[str, int], day: date) -> dict[str, str | None]:
    """Assign today's places jointly so NPCs never overlap or cluster.

    Event participants are placed first, then all remaining NPCs in stable ID
    order. This preserves story relevance and makes results independent of DB
    row order.
    """
    entries = sorted(
        profiles,
        key=lambda entry: (0 if active_events.get(entry["id"]) else 1, entry["id"]),
    )
    occupied: list[tuple[int, int]] = []
    result: dict[str, str | None] = {}
    for entry in entries:
        npc_id, profile = entry["id"], entry["profile"]
        home = HOME_SLOTS[homes[npc_id]]
        candidates = _location_candidates(player_id, npc_id, profile, active_events.get(npc_id), day)
        selected = next(
            (candidate for candidate in candidates if _far_enough(_coordinates(candidate, home), occupied)),
            None,
        )
        # The five widely spaced fallback anchors make this branch unreachable
        # for the product's five-character cap. Keep a defensive best-effort path
        # if legacy/corrupt data contains more residents.
        if selected is None and not _far_enough(home, occupied):
            selected = max(
                candidates,
                key=lambda candidate: _nearest_distance_squared(_coordinates(candidate, home), occupied),
            )
        result[npc_id] = selected
        occupied.append(_coordinates(selected, home))
    return result


def city_payload(player_id: str, profiles: Sequence[dict], active_events: dict[str, object],
                 on_date: date | None = None) -> dict:
    day = on_date or date.today()
    assignments = _home_assignments(player_id, [entry["id"] for entry in profiles])
    daily_assignments = _daily_assignments(player_id, profiles, active_events, assignments, day)
    residents = []
    for entry in profiles:
        npc_id, profile = entry["id"], entry["profile"]
        slot = assignments[npc_id]
        home_x, home_y = HOME_SLOTS[slot]
        active = active_events.get(npc_id)
        location_id = daily_assignments[npc_id]
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
        "map": {"width": 4800, "height": 3000},
        "locations": [asdict(location) for location in CITY_LOCATIONS],
        "npcs": residents,
    }
