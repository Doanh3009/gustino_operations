const ACCOUNT_DOMAIN = 'accounts.gustino.vn'

export function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase('vi').normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
}

export function usernameToEmail(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('@')) return normalized
  return `${normalizeUsername(normalized)}@${ACCOUNT_DOMAIN}`
}

export function emailToUsername(value?: string) {
  if (!value) return ''
  const suffix = `@${ACCOUNT_DOMAIN}`
  return value.toLowerCase().endsWith(suffix) ? value.slice(0, -suffix.length) : value
}

export function validateUsername(value: string) {
  const username = normalizeUsername(value)
  if (username.length < 3) throw new Error('Tên đăng nhập cần ít nhất 3 ký tự.')
  if (username.length > 32) throw new Error('Tên đăng nhập không được quá 32 ký tự.')
  return username
}
