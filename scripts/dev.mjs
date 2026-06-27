import { createServer } from 'vite'

async function lanServerIsReady() {
  try {
    const response = await fetch('http://127.0.0.1:5177/api/health')
    const payload = await response.json()
    return response.ok && payload?.ok === true
  } catch {
    return false
  }
}

if (!(await lanServerIsReady())) {
  await import('./lan-server.mjs')
}

const vite = await createServer()
await vite.listen()
vite.printUrls()
