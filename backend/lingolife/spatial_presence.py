"""Public physical presence, separate from an action's destination/intention."""
from typing import Any

from .city import LOCATION_BY_ID

# These venues have an unambiguous interior. Mixed/open-air sites (university
# campus, market, stadium, terminals, parks…) deliberately remain outdoors.
INDOOR_LOCATIONS = frozenset({
    "central_station", "business_center", "innovation_hub", "design_studio",
    "co_working_loft", "city_hospital", "neighborhood_clinic", "animal_shelter",
    "police_station", "city_hall", "fire_station", "community_center",
    "harbor_mall", "maple_bookshop", "moonlight_cafe", "garden_cafe",
    "harbor_restaurant", "community_gallery", "city_museum", "aurora_theater",
    "music_hall", "city_library", "community_school", "greenway_gym",
})


def spatial_presence(*, current_location_id: str, target_location_id: str,
                     status: str, home_location_id: str, household_id: str) -> dict[str, Any]:
    def city_location(value: str) -> str:
        return home_location_id if household_id and value.startswith(household_id + ":") else value

    current, target = city_location(current_location_id), city_location(target_location_id)
    # Walking between rooms is still inside. Planning to leave is not leaving.
    if status == "traveling" and target and target != current:
        return {"mode": "traveling", "location_id": current, "building_id": None}
    inside = current == home_location_id or current in INDOOR_LOCATIONS
    return {"mode": "indoor" if inside else "outdoor", "location_id": current,
            "building_id": current if inside else None}


assert INDOOR_LOCATIONS <= LOCATION_BY_ID.keys()
