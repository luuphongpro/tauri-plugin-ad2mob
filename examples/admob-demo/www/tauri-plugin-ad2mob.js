// node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// node_modules/@tauri-apps/api/core.js
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}

class Channel {
  constructor(onmessage) {
    _Channel_onmessage.set(this, undefined);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, undefined);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {}), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = new WeakMap, _Channel_nextMessageIndex = new WeakMap, _Channel_pendingMessages = new WeakMap, _Channel_messageEndIndex = new WeakMap, SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}

class PluginListener {
  constructor(plugin, event, channelId) {
    this.plugin = plugin;
    this.event = event;
    this.channelId = channelId;
  }
  async unregister() {
    return invoke(`plugin:${this.plugin}|remove_listener`, {
      event: this.event,
      channelId: this.channelId
    });
  }
}
async function addPluginListener(plugin, event, cb) {
  const handler = new Channel(cb);
  try {
    await invoke(`plugin:${plugin}|register_listener`, {
      event,
      handler
    });
    return new PluginListener(plugin, event, handler.id);
  } catch {
    await invoke(`plugin:${plugin}|registerListener`, { event, handler });
    return new PluginListener(plugin, event, handler.id);
  }
}
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
_Resource_rid = new WeakMap;

// guest-js/errors.ts
class AdMobError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "AdMobError";
    this.code = code;
  }
}
function isAdMobError(error) {
  return error instanceof AdMobError;
}
function toAdMobError(error) {
  if (error instanceof AdMobError) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error;
    if (typeof candidate.code === "string") {
      return new AdMobError(candidate.code, typeof candidate.message === "string" ? candidate.message : String(error));
    }
    if (typeof candidate.message === "string") {
      return new AdMobError("NATIVE_ERROR", candidate.message);
    }
  }
  if (typeof error === "string" && error.length > 0) {
    return new AdMobError("NATIVE_ERROR", error);
  }
  return new AdMobError("NATIVE_ERROR", "unknown AdMob plugin error");
}

// node_modules/@tauri-apps/api/event.js
var TauriEvent;
(function(TauriEvent) {
  TauriEvent["WINDOW_RESIZED"] = "tauri://resize";
  TauriEvent["WINDOW_MOVED"] = "tauri://move";
  TauriEvent["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
  TauriEvent["WINDOW_DESTROYED"] = "tauri://destroyed";
  TauriEvent["WINDOW_FOCUS"] = "tauri://focus";
  TauriEvent["WINDOW_BLUR"] = "tauri://blur";
  TauriEvent["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
  TauriEvent["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
  TauriEvent["WINDOW_CREATED"] = "tauri://window-created";
  TauriEvent["WINDOW_SUSPENDED"] = "tauri://suspended";
  TauriEvent["WINDOW_RESUMED"] = "tauri://resumed";
  TauriEvent["WEBVIEW_CREATED"] = "tauri://webview-created";
  TauriEvent["DRAG_ENTER"] = "tauri://drag-enter";
  TauriEvent["DRAG_OVER"] = "tauri://drag-over";
  TauriEvent["DRAG_DROP"] = "tauri://drag-drop";
  TauriEvent["DRAG_LEAVE"] = "tauri://drag-leave";
})(TauriEvent || (TauriEvent = {}));
async function _unlisten(event, eventId) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
  await invoke("plugin:event|unlisten", {
    event,
    eventId
  });
}
async function listen(event, handler, options) {
  var _a;
  const target = typeof (options === null || options === undefined ? undefined : options.target) === "string" ? { kind: "AnyLabel", label: options.target } : (_a = options === null || options === undefined ? undefined : options.target) !== null && _a !== undefined ? _a : { kind: "Any" };
  return invoke("plugin:event|listen", {
    event,
    target,
    handler: transformCallback(handler)
  }).then((eventId) => {
    return async () => _unlisten(event, eventId);
  });
}

// guest-js/events.ts
var cachedAdsSupport = null;
async function usesPluginChannel() {
  if (cachedAdsSupport === null) {
    try {
      cachedAdsSupport = await invoke("plugin:ad2mob|is_supported");
    } catch {
      cachedAdsSupport = false;
    }
  }
  return cachedAdsSupport;
}
async function on(event, handler) {
  if (await usesPluginChannel()) {
    const listener = await addPluginListener("admob", event, handler);
    return async () => {
      await listener.unregister();
    };
  }
  const unlisten = await listen(event, (tauriEvent) => {
    handler(tauriEvent.payload);
  });
  return async () => {
    unlisten();
  };
}

// guest-js/index.ts
async function call(command, args) {
  try {
    return await invoke(`plugin:ad2mob|${command}`, args);
  } catch (error) {
    throw toAdMobError(error);
  }
}
var AdMob = {
  initialize(options) {
    return call("initialize", { options: options ?? {} });
  },
  configure(options) {
    return call("configure", { options });
  },
  isSupported() {
    return call("is_supported");
  },
  getStatus() {
    return call("get_status");
  },
  requestConsent() {
    return call("request_consent");
  },
  getConsentStatus() {
    return call("get_consent_status").then((result) => result.status);
  },
  requestTrackingAuthorization() {
    return call("request_tracking_authorization").then((result) => result.status);
  },
  getTrackingAuthorizationStatus() {
    return call("get_tracking_authorization_status").then((result) => result.status);
  },
  loadInterstitial(options) {
    return call("load_interstitial", { options: options ?? {} });
  },
  showInterstitial() {
    return call("show_interstitial");
  },
  isInterstitialReady() {
    return call("is_interstitial_ready");
  },
  destroyInterstitial() {
    return call("destroy_interstitial");
  },
  loadRewarded(options) {
    return call("load_rewarded", { options: options ?? {} });
  },
  showRewarded(options) {
    return call("show_rewarded", { options: options ?? {} });
  },
  isRewardedReady() {
    return call("is_rewarded_ready");
  },
  destroyRewarded() {
    return call("destroy_rewarded");
  },
  showBanner(options) {
    return call("show_banner", { options: options ?? {} });
  },
  hideBanner() {
    return call("hide_banner");
  },
  isBannerVisible() {
    return call("is_banner_visible");
  },
  setBannerPosition(options) {
    return call("set_banner_position", { options });
  },
  destroyBanner() {
    return call("destroy_banner");
  },
  on(event, handler) {
    return on(event, handler);
  },
  destroy() {
    return call("destroy");
  }
};
var guest_js_default = AdMob;
export {
  AdMob,
  AdMobError,
  guest_js_default as default,
  isAdMobError,
  toAdMobError
};
