"""Server-owned allowlists for every player-selectable avatar value.

The browser is an editor, not the authority for asset names.  The sets below
cover the currently shipped 3D assets plus the aliases used by older saves so
an edited legacy resident does not become impossible to save.
"""

from __future__ import annotations


AVATAR_MODELS = frozenset({"chibi", *(f"city-{index:02d}" for index in range(1, 17))})

AVATAR_HAIR = frozenset({
    "hair-one", "hair-t", "hair-tail", "knight-tail", "hair-variant", "hair-alt",
    # Procedural/legacy aliases retained by the current render mapping.
    "swoop", "bob", "sprout", "bun", "curls", "shaggy", "waves", "pixie",
    "braids", "curly", "ponytail", "locs", "straight", "mohawk",
})
AVATAR_FACES = frozenset({"round", "oval", "bean", "square", "heart", "long"})
AVATAR_EYES = frozenset({
    "dot", "oval", "sleepy", "wink", "sparkle", "curious", "round", "soft", "wide",
})
AVATAR_BROWS = frozenset({"tiny", "straight", "worried", "bold", "soft"})
AVATAR_NOSES = frozenset({"button", "dot", "triangle", "round", "heart", "long", "wide"})
AVATAR_MOUTHS = frozenset({"smile", "open", "cat", "pout", "tongue", "soft", "bold", "tiny"})
AVATAR_OUTFITS = frozenset({
    "student", "traveller", "merchant", "ninja", "knight",
    "jumper", "hoodie", "jacket", "playful", "overalls", "blazer",
    "sweater", "tee", "cardigan", "dress",
})
AVATAR_PANTS = frozenset({"balloon", "straight", "wide", "shorts", "cargo", "pleated"})
AVATAR_ACCESSORIES = frozenset({
    "none", "bag", "hat", "helmet", "mask", "glasses", "earrings", "headphones",
    "scarf", "beanie", "frogclip", "hairclip", "necklace", "freckles",
})
AVATAR_HOME_BACKGROUNDS = frozenset({"bubble", "book", "plant", "retro", "space", "harbor"})

# Colours are material parameters rather than paths, but remain a finite,
# art-directed palette at the write boundary.  Case is normalized before the
# membership check.  The two additional colours were emitted by shipped legacy
# fixtures and therefore belong to the compatibility contract.
AVATAR_SKIN_COLORS = frozenset({
    "#f7d7c4", "#efb99b", "#d99772", "#b87352", "#8b533b", "#57372f", "#f2c7a5",
})
AVATAR_HAIR_COLORS = frozenset({
    "#563b38", "#2d2323", "#65423b", "#b36b43", "#e0b06f", "#6d718d", "#d67683",
})
AVATAR_OUTFIT_COLORS = frozenset({
    "#d87362", "#7a9cc6", "#6e9b83", "#e0ad67", "#8f83bb", "#556477", "#d67683",
    "#b76862",
})

AVATAR_COMPONENT_ALLOWLISTS = {
    "model": AVATAR_MODELS,
    "hair": AVATAR_HAIR,
    "hairColor": AVATAR_HAIR_COLORS,
    "face": AVATAR_FACES,
    "skin": AVATAR_SKIN_COLORS,
    "eyes": AVATAR_EYES,
    "brows": AVATAR_BROWS,
    "nose": AVATAR_NOSES,
    "mouth": AVATAR_MOUTHS,
    "outfit": AVATAR_OUTFITS,
    "outfitColor": AVATAR_OUTFIT_COLORS,
    "pants": AVATAR_PANTS,
    "accessory": AVATAR_ACCESSORIES,
    "homeBackground": AVATAR_HOME_BACKGROUNDS,
}
