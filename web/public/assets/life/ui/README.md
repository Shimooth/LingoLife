# Life-state UI assets

Runtime subset imported from the curated local asset library on 2026-08-28.

- `emotes/vector_style6.png` and its XML atlas come from **Kenney Emotes Pack**.
- `vfx/*.png` come from **Kenney Particle Pack** and are the transparent variants.
- The original licenses are retained in `licenses/`.

`CharacterEmote.tsx` renders the authored 32×38 speech-bubble cells directly;
it does not approximate them with platform-dependent emoji. VFX remain a
secondary accent and are softened by CSS so the state bubble stays readable.

The current Chibi and City character GLBs expose 11 and 47 compatible clips
respectively, but do not share the KayKit or Quaternius source skeletons. The
runtime therefore uses the existing compatible clips plus emotes and VFX.
Furniture-contact motions such as true chair sitting, eating, lying in bed,
and table-height item handling still require an offline retargeting/export
pass before they can safely replace these fallbacks.
