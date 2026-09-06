import assert from 'node:assert/strict'
import { openQaPage, waitFor, delay } from './browser-cdp.mjs'

const page = await openQaPage()
const base = `${process.env.QA_WEB_URL ?? 'http://127.0.0.1:5173'}/scripts/fixtures/resident-preview.html`
const clickText = text => page.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes(${JSON.stringify(text)})).click()`)
const probe = async () => {
  await page.evaluate(`(async () => {
    const {_roots} = await import('/node_modules/.vite/deps/@react-three_fiber.js');
    window.qaBones = () => {
      const bones = [];
      [..._roots.values()][0].store.getState().scene.traverse(object => {
        if(object.isBone) bones.push({id: object.uuid, pose: [...object.position.toArray(), ...object.quaternion.toArray()]});
      });
      return bones;
    };
  })()`)
  await waitFor(page, `window.qaBones().length > 5`)
}
const assertAnimating = async label => {
  await delay(350)
  const before = await page.evaluate('window.qaBones()')
  await delay(400)
  const after = await page.evaluate('window.qaBones()')
  assert.equal(after[0].id, before[0].id, `${label}: skeleton should be stable between frames`)
  assert.ok(before.some((bone, index) => bone.pose.some((value, axis) => Math.abs(value - after[index].pose[axis]) > .00001)), `${label}: current skeleton must animate`)
}
try {
  await page.call('Emulation.setDeviceMetricsOverride', {width:1440, height:1000, deviceScaleFactor:1, mobile:false})
  await page.call('Page.navigate', {url:base})
  await waitFor(page, `document.querySelector('.onboarding-loop')`)
  await clickText('安排第一批居民')
  await waitFor(page, `document.querySelector('canvas')`)
  await delay(800)
  await probe()
  await assertAnimating('Initial resident')
  assert.equal(await page.evaluate(`document.querySelector('.onboarding-preview').getBoundingClientRect().height`), 640)
  await clickText('选择外观')
  await page.evaluate(`window.qaCanvas = document.querySelector('canvas'); window.qaName = document.querySelector('.onboarding-editor input').value`)
  for (let index = 0; index < 17; index++) {
    await page.evaluate(`document.querySelectorAll('.character-model-picker>button')[${index}].click()`)
    await delay(100)
    assert.equal(await page.evaluate(`window.qaCanvas === document.querySelector('canvas') && window.qaName === document.querySelector('.onboarding-editor input').value`), true)
  }
  await delay(600)
  assert.equal(await page.evaluate(`[...document.querySelectorAll('.character-model-picker img')].every(img => img.complete && img.naturalWidth === 216)`), true)
  await clickText('走动')
  await assertAnimating('Walking city resident')
  await page.call('Emulation.setDeviceMetricsOverride', {width:390, height:844, deviceScaleFactor:1, mobile:true})
  await delay(300)
  assert.equal(await page.evaluate('document.documentElement.scrollWidth'), 390)
  // A dedicated fixture uses the exact production studio and a fresh, in-memory avatar.
  await page.call('Page.navigate', {url:`${base}?mode=studio`})
  await waitFor(page, `document.querySelector('canvas')`)
  await delay(700)
  await clickText('外观')
  await probe()
  await assertAnimating('Chibi before customization')
  for (const legend of ['发型', '穿着', '配饰', '肤色', '发色']) {
    const previous = await page.evaluate('window.qaBones()[0].id')
    await page.evaluate(`Array.from(document.querySelectorAll('fieldset')).find(field => field.querySelector('legend').textContent === ${JSON.stringify(legend)}).querySelector('button:not(.chosen)').click()`)
    await delay(150)
    assert.notEqual(await page.evaluate('window.qaBones()[0].id'), previous, `${legend}: exercise replacement skeleton`)
    await assertAnimating(`Chibi after ${legend}`)
  }
  await page.call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion', value:'reduce'}]})
  await page.call('Page.navigate', {url:`${base}?lang=en`})
  await waitFor(page, `document.querySelector('.onboarding-loop')`)
  await clickText('Set up the first residents')
  await waitFor(page, `document.querySelector('canvas')`)
  await delay(800)
  await probe()
  assert.equal(await page.evaluate(`[...document.querySelectorAll('.onboarding-preview__motions button')].every(button => button.disabled)`), true)
  const paused = await page.evaluate('window.qaBones()')
  await delay(350)
  assert.deepEqual(await page.evaluate('window.qaBones()'), paused, 'Reduced motion must hold a settled pose')
  await clickText('Appearance')
  assert.equal(await page.evaluate(`document.querySelector('.character-model-picker').textContent.includes('City resident')`), true)
  assert.deepEqual(page.errors, [])
  console.log('Resident preview browser checks passed: 17 models, stable Canvas/data, moving replacement skeletons, mobile, English, reduced motion; no account/API writes.')
} finally { await page.close() }
