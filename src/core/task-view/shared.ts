import { now } from '../utils.js'

export type JsonEnvelopeV2 = {
  schema_version: 2
  generated_at: string
}

export function jsonEnvelopeV2(): JsonEnvelopeV2 {
  return {
    schema_version: 2,
    generated_at: now(),
  }
}

export const SCHEMA5_VIEW_SAMPLE_LIMIT = 8

export function concise(value: string, limit = 160) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= limit) return compact
  return `${compact.slice(0, limit - 1).trimEnd()}…`
}
