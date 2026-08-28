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
