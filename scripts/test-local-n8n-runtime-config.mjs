import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(source
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
  }))

const failures = []
if (String(env.N8N_REPORT_ENABLED).toLowerCase() !== 'true') failures.push('N8N_REPORT_ENABLED chưa bật.')
if (!env.N8N_REPORT_WEBHOOK_URL) failures.push('Thiếu N8N_REPORT_WEBHOOK_URL.')
if (!env.N8N_REPORT_WEBHOOK_TOKEN) failures.push('Thiếu N8N_REPORT_WEBHOOK_TOKEN.')
if (env.N8N_REPORT_WEBHOOK_URL?.includes('/webhook-test/')) failures.push('Đang dùng test webhook; URL này không chạy lâu dài khi workflow không ở chế độ lắng nghe test.')
if (env.N8N_REPORT_WEBHOOK_URL && !env.N8N_REPORT_WEBHOOK_URL.startsWith('https://')) failures.push('Webhook n8n không dùng HTTPS.')

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}
console.log('LOCAL_N8N_RUNTIME_CONFIG_OK')
