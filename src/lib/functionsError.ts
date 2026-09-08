type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function functionsErrorStatus(error: unknown): number | undefined {
  const context = asRecord(asRecord(error)?.context)
  return typeof context?.status === 'number' ? context.status : undefined
}

export async function functionsErrorMessage(error: unknown, fallback: string): Promise<string> {
  const errorRecord = asRecord(error)
  const context = asRecord(errorRecord?.context)
  let payload: UnknownRecord | null = null

  if (context) {
    let body: unknown = context
    if (typeof context.clone === 'function') {
      try {
        body = (context.clone as () => unknown)()
      } catch {
        body = context
      }
    }

    const bodyRecord = asRecord(body)
    if (typeof bodyRecord?.json === 'function') {
      try {
        payload = asRecord(await (bodyRecord.json as () => Promise<unknown>)())
      } catch {
        payload = null
      }
    }
    payload ||= context
  }

  return nonEmptyString(payload?.error)
    || nonEmptyString(payload?.message)
    || nonEmptyString(errorRecord?.message)
    || fallback
}
