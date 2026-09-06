import { mkdir, writeFile } from 'node:fs/promises'
import { openQaPage, waitFor } from './browser-cdp.mjs'

const page = await openQaPage()
try {
  await page.call('Page.navigate', { url: `${process.env.QA_WEB_URL ?? 'http://127.0.0.1:5173'}/scripts/fixtures/resident-preview.html` })
  await waitFor(page, `document.querySelector('.onboarding-shell')`)
  const portraits = await page.evaluate(`(async () => {
    const {CHARACTER_PRESETS} = await import('/src/three/characters/characterAssets.ts');
    const {defaultAvatar} = await import('/src/avatar.ts');
    const {getCharacterPortrait} = await import('/src/three/characters/characterPortrait.ts');
    const portraits = [];
    for (const preset of CHARACTER_PRESETS) portraits.push({id: preset.id, data: await getCharacterPortrait({...defaultAvatar, model: preset.id})});
    return portraits;
  })()`)
  const directory = new URL('../public/assets/portraits/characters/', import.meta.url)
  await mkdir(directory, { recursive: true })
  for (const portrait of portraits) await writeFile(new URL(`${portrait.id}.webp`, directory), Buffer.from(portrait.data.split(',')[1], 'base64'))
  console.log(`Rendered ${portraits.length} compressed portraits from the same models/materials used in game.`)
} finally { await page.close() }
