# LingoLife interior runtime subset

This directory contains the small, runtime-ready subset of the locally curated
asset library used by household cutaways and life-story encounters. The source
packs remain outside the repository; only models that are rendered by the app,
their external `.bin`/texture dependencies, and their licenses are copied here.

Runtime mapping (the same source meshes are art-directed into distinct layouts
instead of treating every public venue as a generic room):

- `furniture/`: residential lounge, bedroom, study, and public reading areas
- `kitchen/`: home kitchens and café seating/counters
- `bathroom/`: private bathroom stories and cutaways
- `restaurant/`: tableware and prepared-food details in commercial venues
- `plants/`: shared interior dressing
- `park/`: outdoor life-story staging for parks and plazas

Authored scene themes currently cover living room, kitchen, bathroom, bedroom,
café/restaurant, library/bookshop, retail, workplace/civic interior,
activity/practice space, general public interior, and parks. Each model is
wrapped by an individual loading/error fallback so one broken mesh cannot blank
the room or the application.

The production shared-home baseline is declared in
`config/shared-home-layout.json`. It is one residence with four connected
functional cutaways: lounge, kitchen, bathroom, and a private-bedroom wing.
That wing now contains eight actual resident-owned micro-bedrooms rather than a
dormitory row. Every room has explicit bounds, a corridor-facing open door, a
unique bed/sleep anchor, a floor lamp, personal storage, a distinct color and a
small hobby or keepsake trace. A continuous central hall connects all eight
door approaches to the residence entrance without furniture crossing the
walking clearance. The lounge still stages all eight residents, and semantic
anchors cover all 13 first-phase Life Actions.

The renderer uses cutaway-height foreground walls so the architecture remains
readable on a phone without pretending the rooms are open pods. Back rooms use
taller walls and individual windows; front rooms keep low exterior walls for
the isometric camera. Resident assignment follows the durable
`private_room_id` slot and falls back to the same sorted-roster rule as the
server, so changing list order cannot silently swap bedrooms. Occupied rooms
are identified with the resident name at the door, while private actions never
render the resident model.

`web/scripts/check-shared-home.mjs` is the executable art contract. It checks
2/4/8 assignment uniqueness, room-boundary separation, one-to-one fixture and
anchor ownership, corridor/door reachability, minimum doorway width, furniture
clearance, missing assets and overlap. Run it alongside the normal web lint and
build whenever this layout or its runtime subset changes.

Asset licenses are preserved verbatim in `licenses/`. Source packs:

- KayKit Furniture Bits (free)
- KayKit Restaurant Bits (free)
- Tiny Treats Bubbly Bathroom (free)
- Tiny Treats Charming Kitchen (free)
- Tiny Treats House Plants (free)
- Tiny Treats Pretty Park (free)

The app treats these meshes as presentation assets only. Room choice, resource
occupancy, actions, and story locations continue to come from server-owned
observable life-simulation state. Private actions are shown as a closed/private
room state; resident models are never placed into the bathroom or bedroom
cutaway while that private action is active.
