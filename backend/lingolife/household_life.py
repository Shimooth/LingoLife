"""Only visible household facts. No needs, decision scores or private inventory leaks."""
from typing import Any, Mapping
from .dinner import public_dinner


def public_home_life(state: Mapping[str, Any], household_id: str) -> dict[str, Any]:
    meals = [item for item in state.get("household_food", [])
             if item.get("household_id") == household_id
             and item.get("active", True) and item.get("access") == "shared"]
    dishes = [item for item in state.get("responsibilities", [])
              if item.get("household_id") == household_id
              and item.get("active") and item.get("kind") == "dishes"]
    result = {
        "shared_meals": [{"id": str(item["id"]), "prepared_by": str(item["owner_id"]),
                          "prepared_at": item.get("prepared_at")}
                         for item in meals[-8:]],
        "dirty_dishes_count": min(8, max(len(dishes), int((state.get("households", {}).get(household_id, {}).get("state") or {}).get("dirty_dishes", 0)))),
    }
    dinner = public_dinner(state, household_id)
    if dinner:
        result["dinner"] = dinner
    return result
