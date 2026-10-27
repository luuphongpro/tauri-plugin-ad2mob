import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  addPluginListener: vi.fn(),
}))

import { AdMob } from '../../guest-js'
import { AdMobError, isAdMobError } from '../../guest-js/errors'

beforeEach(() => {
  invokeMock.mockReset()
})

describe('AdMob.initialize', () => {
  it('invokes the initialize command with the provided config', async () => {
    invokeMock.mockResolvedValue({ initialized: true, platform: 'android', testing: true })

    const result = await AdMob.initialize({
      androidAppId: 'ca-app-pub-3940256099942544~3347511713',
      isTesting: true,
    })

    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|initialize', {
      options: {
        androidAppId: 'ca-app-pub-3940256099942544~3347511713',
        isTesting: true,
      },
    })
    expect(result).toEqual({ initialized: true, platform: 'android', testing: true })
  })

  it('sends an empty options object when called without arguments', async () => {
    invokeMock.mockResolvedValue({ initialized: true, platform: 'ios', testing: false })
    await AdMob.initialize()
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|initialize', { options: {} })
  })
})

describe('AdMob.configure', () => {
  it('forwards ad unit ids', async () => {
    invokeMock.mockResolvedValue(null)
    await AdMob.configure({
      adUnitIds: { banner: 'ca-app-pub-3940256099942544/6300978111' },
    })
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|configure', {
      options: { adUnitIds: { banner: 'ca-app-pub-3940256099942544/6300978111' } },
    })
  })
})

describe('interstitial and rewarded flows', () => {
  it('loads and shows an interstitial', async () => {
    invokeMock.mockResolvedValue(null)
    await AdMob.loadInterstitial()
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'plugin:ad2mob|load_interstitial', {
      options: {},
    })

    await AdMob.loadInterstitial({ adUnitId: 'ca-app-pub-3940256099942544/1033173712' })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'plugin:ad2mob|load_interstitial', {
      options: { adUnitId: 'ca-app-pub-3940256099942544/1033173712' },
    })

    await AdMob.showInterstitial()
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'plugin:ad2mob|show_interstitial', undefined)
  })

  it('loads and shows a rewarded ad with optional SSV parameters', async () => {
    invokeMock.mockResolvedValue(null)
    await AdMob.loadRewarded()
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'plugin:ad2mob|load_rewarded', {
      options: {},
    })

    await AdMob.showRewarded()
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'plugin:ad2mob|show_rewarded', {
      options: {},
    })

    await AdMob.showRewarded({ userId: 'user-123', customData: 'level-42' })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'plugin:ad2mob|show_rewarded', {
      options: { userId: 'user-123', customData: 'level-42' },
    })
  })

  it('queries readiness without arguments', async () => {
    invokeMock.mockResolvedValue(true)
    await expect(AdMob.isInterstitialReady()).resolves.toBe(true)
    await expect(AdMob.isRewardedReady()).resolves.toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|is_interstitial_ready', undefined)
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|is_rewarded_ready', undefined)
  })
})

describe('banner API', () => {
  it('applies documented defaults when called without options', async () => {
    invokeMock.mockResolvedValue(null)
    await AdMob.showBanner()
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|show_banner', { options: {} })
  })

  it('forwards position and size', async () => {
    invokeMock.mockResolvedValue(null)
    await AdMob.showBanner({ position: 'top', size: 'largeBanner' })
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|show_banner', {
      options: { position: 'top', size: 'largeBanner' },
    })

    await AdMob.setBannerPosition({ position: 'bottom' })
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|set_banner_position', {
      options: { position: 'bottom' },
    })
  })
})

describe('status and privacy queries', () => {
  it('returns the typed status snapshot', async () => {
    invokeMock.mockResolvedValue({
      initialized: true,
      platform: 'android',
      testing: true,
      consentStatus: 'obtained',
      trackingStatus: 'notAvailable',
      interstitialReady: false,
      rewardedReady: true,
      bannerVisible: true,
    })

    const status = await AdMob.getStatus()
    expect(status.consentStatus).toBe('obtained')
    expect(status.bannerVisible).toBe(true)
  })

  it('unwraps consent and tracking statuses', async () => {
    invokeMock.mockResolvedValueOnce({ status: 'notRequired' })
    invokeMock.mockResolvedValueOnce({ status: 'authorized' })

    await expect(AdMob.getConsentStatus()).resolves.toBe('notRequired')
    await expect(AdMob.getTrackingAuthorizationStatus()).resolves.toBe('authorized')
  })
})

describe('error semantics', () => {
  it('converts structured rejections into AdMobError', async () => {
    invokeMock.mockRejectedValue({ code: 'CONSENT_REQUIRED', message: 'consent first' })

    const error: unknown = await AdMob.requestConsent().catch((e) => e)
    expect(isAdMobError(error)).toBe(true)
    if (isAdMobError(error)) {
      expect(error.code).toBe('CONSENT_REQUIRED')
      expect(error.message).toBe('consent first')
      expect(error).toBeInstanceOf(AdMobError)
    }
  })

  it('falls back to NATIVE_ERROR for opaque rejections', async () => {
    invokeMock.mockRejectedValue('boom')
    const error: AdMobError = await AdMob.destroyBanner().catch((e) => e)
    expect(error.code).toBe('NATIVE_ERROR')
    expect(error.message).toBe('boom')
  })
})

describe('cleanup', () => {
  it('invokes destroy and per-format destroy commands', async () => {
    invokeMock.mockResolvedValue(null)
    await AdMob.destroyInterstitial()
    await AdMob.destroyRewarded()
    await AdMob.destroyBanner()
    await AdMob.destroy()
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|destroy_interstitial', undefined)
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|destroy_rewarded', undefined)
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|destroy_banner', undefined)
    expect(invokeMock).toHaveBeenCalledWith('plugin:ad2mob|destroy', undefined)
  })
})
