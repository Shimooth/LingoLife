# Character model portraits

17 transparent 216 × 256 WebP images, rendered from this project's existing GLB assets.
Not AI illustrations: model selection and live residents share `characterModel.ts` for
mesh visibility, colors and materials. Static model swatches use `defaultAvatar`;
the resident roster renders the resident's actual current colors/clothing and caches
the compressed image locally in memory. No image-upload or AI API is involved.

These derivatives retain the source asset licenses under `assets/models/characters`.

To regenerate: start the local Vite server and an isolated headless Chrome with
`--remote-debugging-port=19226 --user-data-dir=<new temporary directory>`, then run
`node web/scripts/render-character-portraits.mjs` from the project root.
Optional variables: `QA_WEB_URL`, `QA_CDP_URL`.

The fixture under `web/scripts/fixtures` is for local visual tests only. It is not
included in the production Vite entry and never calls account or onboarding APIs.
