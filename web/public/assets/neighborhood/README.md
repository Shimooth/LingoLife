# Neighborhood presentation assets

This runtime subset supports the toy-like fountain plaza, local news desk and
clothing shop. It contains **122,967 bytes** of selected external assets and
licenses, plus this README and the SHA-256 manifest. No paid asset or generated
image is included.

- `counter_table.*`, `cash_register.*`, `tiny_treats_texture_1.png`: Isa
  Lousberg / Tiny Treats, **Bakery Interior 1.1 FREE**, CC0.
  Official source: <https://tinytreats.itch.io/bakery-interior>.
  Imported unmodified from the existing local source archive; its SHA-256 was
  checked against the pre-existing acquisition inventory before copying.
- `emote_heart.png`: Kenney **Emotes Pack**, PNG / Vector / Style 6, CC0.
  Official source: <https://kenney.nl/assets/emotes-pack>. Copied unmodified.
- Original license files are included. `manifest.json` records every imported
  file's SHA-256, size, origin and whether it was modified.

The fountain, park tree/bench, house plant and their textures reuse the already
shipped `assets/life/interiors` subsets (Tiny Treats Pretty Park and House
Plants), whose CC0 licenses remain in `assets/life/interiors/licenses`.
Character meshes and motions reuse the existing character/motion directories
and their existing license records.

Rounded platform edges, gift box/ribbon, microphone, clothing rack, small shirt
silhouettes, toy storefront, colored news trim and fountain water effects are original Three.js
geometry written for LingoLife; they are **not** downloaded stock assets.
The preview actor uses the resident's real avatar with the selected outfit.
Display normalization and material clones happen at runtime. `Fountain3D` preserves
the source stone/leaves atlas, gives water its own physical material and a small
procedural bump texture, and adds four flowing jets with impact rings above a thin
round plinth. Only a runtime clone of the water UVs is changed; original GLTF
geometry, textures and source files remain unchanged. These scenes do not claim to
convert low-poly source models into high-poly models.

Loading one decorative model can fail independently without blocking scene
text, choices, skipping or game settlement. Scene playback never grants coins,
items, relationships, or unlocks.

发布整理：两份许可文件仅统一 LF 行尾并移除行尾空白，许可文字不变；清单记录整理后大小和 SHA-256。
