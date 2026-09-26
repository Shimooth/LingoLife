"""New city fabric has a composed skyline; published layouts are not migrated."""

from lingolife.layouts import _default_buildings, _fabric_building_style


def test_default_fabric_keeps_legal_uniform_footprint_and_varies_height():
    buildings = _default_buildings()
    fabric = [item for item in buildings if item["id"].startswith("fabric-")]
    assert fabric
    scales = {item["scale"]["x"] for item in fabric}
    assert len(scales) >= 3
    for item in fabric:
        scale = item["scale"]
        assert 1 <= scale["x"] <= 1.13
        assert scale["x"] == scale["y"] == scale["z"]
        assert item["position"]["y"] == .369


def test_fabric_front_is_lower_and_model_families_do_not_change():
    families = {
        "residential": {"building_A", "building_B", "building_C"},
        "commercial": {"building_D", "building_E"},
        "public": {"building_F", "building_G", "building_H"},
    }
    for family, models in families.items():
        for gx in range(-10, 11):
            for gz in range(-6, 7):
                model, scale = _fabric_building_style(family, gx * 2.6, gz * 2.6)
                assert model in models
                assert 1 <= scale <= 1.13
                if .65 * gx * 2.6 + .76 * gz * 2.6 >= 8:
                    assert model not in {"building_C", "building_D", "building_G", "building_H"}


def test_fabric_shared_frontend_backend_examples():
    # The TypeScript algorithm uses the same integer grid/variant formula.
    assert _fabric_building_style("residential", 15.6, 10.4) == ("building_A", 1.05)
    assert _fabric_building_style("public", -13, -13) == ("building_G", 1.08)
    assert _fabric_building_style("commercial", 0, 0) == ("building_D", 1.035)
