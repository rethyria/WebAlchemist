/**
 * The vault locks itself after a period without use. Runs the real storage and
 * vault code against the in-memory browser mock. The mock records the alarms
 * that get scheduled, and a test calls the alarm handler directly in place of
 * the browser delivering the alarm.
 */

import { alarmsMock, resetBrowserMock } from './test-support/browser-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Provider } from '@shared/types'
import { DEFAULT_VAULT_IDLE_MINUTES } from '@shared/vault-policy'
import * as storage from './storage'
import { IDLE_ALARM } from './vault'

const PASSPHRASE = 'correct horse battery'

const provider = {
  id: 'p1',
  label: 'Remote',
  type: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  generateModel: 'm',
  reviewModel: 'm',
  supportsVision: false,
} as unknown as Provider

async function sealedAndUnlocked(): Promise<void> {
  await storage.saveCredentialFor(provider, { kind: 'api_key', value: 'sk-x' })
  await storage.enableVault(PASSPHRASE)
}

const setIdle = (vaultIdleLockMinutes: number) =>
  storage.saveSettings({ ...DEFAULT_SETTINGS, vaultIdleLockMinutes })

beforeEach(() => {
  resetBrowserMock()
})

describe('the idle lock', () => {
  it('defaults to 30 minutes', () => {
    expect(DEFAULT_SETTINGS.vaultIdleLockMinutes).toBe(30)
    expect(DEFAULT_VAULT_IDLE_MINUTES).toBe(30)
  })

  it('schedules an alarm when the vault is enabled and when it is unlocked', async () => {
    await sealedAndUnlocked()
    expect(alarmsMock.scheduled.get(IDLE_ALARM)).toEqual({ delayInMinutes: 30 })

    await storage.lockVault()
    expect(alarmsMock.scheduled.has(IDLE_ALARM)).toBe(false)

    await storage.unlockVault(PASSPHRASE)
    expect(alarmsMock.scheduled.get(IDLE_ALARM)).toEqual({ delayInMinutes: 30 })
  })

  it('locks the vault when the alarm fires, and a provider call then fails as locked', async () => {
    await sealedAndUnlocked()
    expect(await storage.vaultState()).toEqual({ sealed: true, unlocked: true })

    await storage.handleVaultIdleAlarm({ name: IDLE_ALARM })

    expect(await storage.vaultState()).toEqual({ sealed: true, unlocked: false })
    await expect(storage.readCredentialForRequest(provider)).rejects.toMatchObject({ name: 'LockedError' })
  })

  it('restarts the countdown on each provider call', async () => {
    await sealedAndUnlocked()
    const before = alarmsMock.created.length

    await storage.readCredentialForRequest(provider)

    expect(alarmsMock.created.length).toBe(before + 1)
  })

  it('is not restarted by reading credential statuses', async () => {
    await sealedAndUnlocked()
    const before = alarmsMock.created.length

    await storage.getCredentialStatus('p1')
    await storage.getAllCredentialStatuses()

    expect(alarmsMock.created.length).toBe(before)
  })

  it('ignores alarms with another name', async () => {
    await sealedAndUnlocked()

    await storage.handleVaultIdleAlarm({ name: 'something-else' })

    expect((await storage.vaultState()).unlocked).toBe(true)
  })
})

describe('the period setting', () => {
  it('applies a new period to a vault that is already unlocked', async () => {
    await sealedAndUnlocked()

    await setIdle(5)

    expect(alarmsMock.scheduled.get(IDLE_ALARM)).toEqual({ delayInMinutes: 5 })
  })

  it('never: cancels the alarm that was running and schedules none afterwards', async () => {
    await sealedAndUnlocked()

    await setIdle(0)
    expect(alarmsMock.scheduled.has(IDLE_ALARM)).toBe(false)

    await storage.readCredentialForRequest(provider)
    await storage.lockVault()
    await storage.unlockVault(PASSPHRASE)
    expect(alarmsMock.scheduled.has(IDLE_ALARM)).toBe(false)
    expect((await storage.vaultState()).unlocked).toBe(true)
  })

  it('does not restart the countdown when an unrelated setting changes', async () => {
    await sealedAndUnlocked()
    const before = alarmsMock.created.length

    await storage.saveSettings({ ...DEFAULT_SETTINGS, accent: 'red' })

    expect(alarmsMock.created.length).toBe(before)
  })

  it.each([-1, 1.5, Number.NaN])('refuses %s as a period', async (minutes) => {
    await expect(setIdle(minutes)).rejects.toThrow(/whole number/)
  })

  it('control: a vault that is not sealed never schedules an alarm', async () => {
    await storage.saveCredentialFor(provider, { kind: 'api_key', value: 'sk-x' })
    await storage.readCredentialForRequest(provider)
    await setIdle(5)

    expect(alarmsMock.created).toHaveLength(0)
  })
})
