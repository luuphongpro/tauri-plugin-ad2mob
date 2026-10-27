/**
 * Event subscription for `tauri-plugin-ad2mob`.
 *
 * Two delivery paths exist by design:
 *
 * - Android/iOS: the native layer triggers `admob://*` events through the
 *   Tauri plugin event channel; guests subscribe with `addPluginListener`.
 * - Desktop: the plugin has no native layer, so the Rust core emits the events
 *   on the global event system and guests subscribe with `listen`.
 *
 * `AdMob.on()` picks the right mechanism transparently and returns an
 * awaitable `unlisten` function so listeners never outlive their use.
 */

import { addPluginListener, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AdMobEventMap, AdMobEventName } from './types.js'

/** Function that removes a listener once (awaitable). */
export type Unlisten = () => Promise<void>

let cachedAdsSupport: boolean | null = null

/**
 * `true` when the current platform runs ads natively (Android/iOS) and the
 * plugin event channel is therefore the active delivery path.
 */
async function usesPluginChannel(): Promise<boolean> {
  if (cachedAdsSupport === null) {
    try {
      cachedAdsSupport = await invoke<boolean>('plugin:ad2mob|is_supported')
    } catch {
      cachedAdsSupport = false
    }
  }
  return cachedAdsSupport
}

/**
 * Subscribes to a plugin event.
 *
 * ```ts
 * const unlisten = await AdMob.on('admob://rewarded-earned', ({ payload }) => {
 *   console.log(`Reward: ${payload.amount} ${payload.type}`)
 * })
 *
 * // later:
 * await unlisten()
 * ```
 */
export async function on<E extends AdMobEventName>(
  event: E,
  handler: (payload: AdMobEventMap[E]) => void,
): Promise<Unlisten> {
  if (await usesPluginChannel()) {
    const listener = await addPluginListener<AdMobEventMap[E]>('ad2mob', event, handler)
    return async () => {
      await listener.unregister()
    }
  }

  const unlisten = await listen<AdMobEventMap[E]>(event, (tauriEvent) => {
    handler(tauriEvent.payload)
  })
  return async () => {
    unlisten()
  }
}

/** @internal test helper: resets the cached platform detection. */
export function __resetEventChannelCache(): void {
  cachedAdsSupport = null
}
