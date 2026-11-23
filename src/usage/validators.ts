import { Machine, UsageMeter } from '../graphql/schema'

const CHATGPT_PLANS = new Set(['free', 'plus', 'pro', 'team', 'business', 'enterprise', 'edu', 'unknown'])
const CHATGPT_WINDOWS = ['fiveHour', 'week']
const MAX_MACHINES = 100
const MACHINE_OPTIONAL_VERSIONS = ['codexVersion', 'claudeCodeVersion']

/** A ChatGPT snapshot older than this is stale but stays readable: a sleeping Mac shows stale data, not nothing. */
export const CHATGPT_STALE_MS = 10 * 60_000

/** A machines snapshot older than this is stale (matches the dash threshold). */
export const MACHINES_STALE_MS = 15 * 60_000

/** Upload freshness: reject the replay of an old local file or fabricated future freshness. */
export const CHATGPT_UPLOAD_MAX_AGE_MS = 10 * 60_000
export const MACHINES_UPLOAD_MAX_AGE_MS = 15 * 60_000
export const UPLOAD_MAX_FUTURE_MS = 60_000

export interface ChatGPTSnapshot {
  version: number
  plan: string
  fetchedAt: string
  meters: UsageMeter[]
}

export interface MachineSnapshotData {
  version: number
  fetchedAt: string
  machines: Machine[]
}

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value))

const exactKeys = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key))

const isCliVersion = (value: unknown): boolean =>
  value === null || (typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value))

export function normalizeChatGPTSnapshot(value: unknown): ChatGPTSnapshot | null {
  if (
    !exactKeys(value, ['version', 'plan', 'fetchedAt', 'meters']) ||
    value.version !== 1 ||
    typeof value.plan !== 'string' ||
    !CHATGPT_PLANS.has(value.plan) ||
    !isTimestamp(value.fetchedAt) ||
    !Array.isArray(value.meters) ||
    value.meters.length < 1 ||
    value.meters.length > 2
  ) {
    return null
  }

  const seen = new Set<string>()
  const meters: UsageMeter[] = []
  for (const meter of value.meters) {
    if (
      !exactKeys(meter, ['window', 'usedPercent', 'resetsAt']) ||
      typeof meter.window !== 'string' ||
      !CHATGPT_WINDOWS.includes(meter.window) ||
      seen.has(meter.window) ||
      typeof meter.usedPercent !== 'number' ||
      !Number.isFinite(meter.usedPercent) ||
      meter.usedPercent < 0 ||
      meter.usedPercent > 100 ||
      (meter.resetsAt !== null && !isTimestamp(meter.resetsAt))
    ) {
      return null
    }
    seen.add(meter.window)
    meters.push({
      window: meter.window,
      usedPercent: meter.usedPercent,
      resetsAt: meter.resetsAt === null ? null : new Date(meter.resetsAt).toISOString(),
    })
  }

  meters.sort((a, b) => CHATGPT_WINDOWS.indexOf(a.window) - CHATGPT_WINDOWS.indexOf(b.window))
  return { version: 1, plan: value.plan, fetchedAt: new Date(value.fetchedAt).toISOString(), meters }
}

export function normalizeMachineSnapshot(value: unknown): MachineSnapshotData | null {
  if (
    !exactKeys(value, ['version', 'fetchedAt', 'machines']) ||
    value.version !== 1 ||
    !isTimestamp(value.fetchedAt) ||
    !Array.isArray(value.machines) ||
    value.machines.length > MAX_MACHINES
  ) {
    return null
  }

  const ids = new Set<string>()
  const machines: Machine[] = []
  for (const machine of value.machines) {
    const keys = ['id', 'name', 'dnsName', 'os', 'online', 'addresses', 'lastSeen', 'openCodeVersion']
    if (typeof machine === 'object' && machine !== null && !Array.isArray(machine)) {
      keys.push(...MACHINE_OPTIONAL_VERSIONS.filter(key => Object.hasOwn(machine, key)))
    }
    if (
      !exactKeys(machine, keys) ||
      typeof machine.id !== 'string' ||
      !/^[\w:-]{1,128}$/.test(machine.id) ||
      ids.has(machine.id) ||
      typeof machine.name !== 'string' ||
      !machine.name.trim() ||
      machine.name.length > 128 ||
      typeof machine.dnsName !== 'string' ||
      machine.dnsName.length > 254 ||
      typeof machine.os !== 'string' ||
      machine.os.length > 32 ||
      (machine.online !== null && typeof machine.online !== 'boolean') ||
      !Array.isArray(machine.addresses) ||
      machine.addresses.length > 8 ||
      !machine.addresses.every(address => typeof address === 'string' && address.length <= 64) ||
      (machine.lastSeen !== null && !isTimestamp(machine.lastSeen)) ||
      !isCliVersion(machine.openCodeVersion) ||
      MACHINE_OPTIONAL_VERSIONS.some(key => Object.hasOwn(machine, key) && !isCliVersion(machine[key]))
    ) {
      return null
    }
    ids.add(machine.id)
    machines.push({
      id: machine.id,
      name: machine.name.trim(),
      dnsName: machine.dnsName,
      os: machine.os,
      online: machine.online,
      addresses: [...new Set(machine.addresses)],
      lastSeen: machine.lastSeen,
      openCodeVersion: machine.openCodeVersion as string | null,
      codexVersion: (machine.codexVersion as string | null | undefined) ?? null,
      claudeCodeVersion: (machine.claudeCodeVersion as string | null | undefined) ?? null,
    })
  }

  return { version: 1, fetchedAt: new Date(value.fetchedAt).toISOString(), machines }
}

/** Mirrors the dash upload rule: `age < -60_000 || age > maxAge` means rejection. */
export function isFreshUpload(fetchedAt: string, maxAgeMs: number, now: number = Date.now()): boolean {
  const age = now - Date.parse(fetchedAt)
  return age >= -UPLOAD_MAX_FUTURE_MS && age <= maxAgeMs
}

export function isStale(fetchedAt: string, staleAfterMs: number, now: number = Date.now()): boolean {
  return now - Date.parse(fetchedAt) > staleAfterMs
}
