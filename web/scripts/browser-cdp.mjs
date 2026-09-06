// Connect only to an explicitly started, isolated QA Chrome. No user profile or login is needed.
export async function openQaPage() {
  const endpoint = process.env.QA_CDP_URL ?? 'http://127.0.0.1:19226'
  const tab = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json()
  const socket = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  let sequence = 0
  const pending = new Map(), errors = [], consoleErrors = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(value => value.value ?? value.description).join(' '))
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
  await call('Runtime.enable')
  return { call, evaluate, errors, consoleErrors, close: async () => { await call('Page.close'); socket.close() } }
}

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function waitFor(page, expression, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await page.evaluate(`Boolean(${expression})`)) return
    await delay(100)
  }
  throw new Error(`Timed out: ${expression}`)
}
