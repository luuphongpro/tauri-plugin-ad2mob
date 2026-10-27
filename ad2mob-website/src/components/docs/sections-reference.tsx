import type { ReactNode } from "react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CodeBlock, type Lang } from "./code-block"
import { Callout, Code, DataTable, ParamTable, Section, type ParamRow } from "./primitives"

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

interface ApiMethod {
  name: string
  signature: string
  returns: string
  desc: ReactNode
  params?: ParamRow[]
  errors?: string[]
  example?: { lang: Lang; code: string; title?: string }
}

interface ApiGroup {
  id: string
  title: string
  methods: ApiMethod[]
}

const API_GROUPS: ApiGroup[] = [
  {
    id: "api-nucleo",
    title: "Núcleo",
    methods: [
      {
        name: "initialize",
        signature: "initialize(options?: AdMobConfig)",
        returns: "Promise<InitializationResult>",
        desc: (
          <>
            Inicializa el SDK de Google Mobile Ads. Es <strong>idempotente</strong>:
            llamarlo de nuevo es un no-op seguro que devuelve el estado actual.
            Con <Code>isTesting: true</Code> los Ad Unit IDs que falten se
            resuelven automáticamente a los oficiales de Google.
          </>
        ),
        params: [
          { name: "options.appId", type: "string", desc: "App ID genérico para ambas plataformas." },
          { name: "options.androidAppId", type: "string", desc: "App ID para Android (prioridad sobre appId)." },
          { name: "options.iosAppId", type: "string", desc: "App ID para iOS (prioridad sobre appId)." },
          { name: "options.isTesting", type: "boolean", desc: "Modo desarrollo: resuelve test IDs oficiales." },
          { name: "options.initializeOnStartup", type: "boolean", desc: "Inicializa al arrancar desde tauri.conf.json." },
          { name: "options.requestTrackingAuthorization", type: "boolean", desc: "Solo iOS: pide ATT tras inicializar." },
          { name: "options.automaticallyRequestConsent", type: "boolean", desc: "Ejecuta el flujo UMP durante la inicialización. Por defecto true." },
          { name: "options.debug", type: "boolean", desc: "Logs detallados del plugin. Sin datos personales." },
        ],
        errors: ["INVALID_CONFIGURATION", "NATIVE_ERROR"],
        example: {
          lang: "ts",
          title: "initialize",
          code: `const result = await AdMob.initialize({
  appId: "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY",
  isTesting: true,
})
// { initialized: true, platform: "android", testing: true }`,
        },
      },
      {
        name: "configure",
        signature: "configure(options: ConfigureOptions)",
        returns: "Promise<void>",
        desc: (
          <>
            Configura los Ad Unit IDs a nivel de aplicación (se fusionan sobre
            los valores previos). Orden de resolución de cualquier ID: argumento
            explícito → <Code>configure()</Code> → test IDs de Google si{" "}
            <Code>isTesting</Code> → error <Code>INVALID_CONFIGURATION</Code>.
          </>
        ),
        params: [
          { name: "options.adUnitIds.banner", type: "string", desc: "Ad Unit ID para banners." },
          { name: "options.adUnitIds.interstitial", type: "string", desc: "Ad Unit ID para intersticiales." },
          { name: "options.adUnitIds.rewarded", type: "string", desc: "Ad Unit ID para rewarded." },
        ],
        errors: ["INVALID_ARGUMENT"],
        example: {
          lang: "ts",
          title: "configure",
          code: `await AdMob.configure({
  adUnitIds: {
    banner: "ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY",
    interstitial: "ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY",
    rewarded: "ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY",
  },
})`,
        },
      },
      {
        name: "isSupported",
        signature: "isSupported()",
        returns: "Promise<boolean>",
        desc: (
          <>
            Devuelve <Code>true</Code> en Android e iOS, <Code>false</Code> en
            Windows, macOS y Linux. Úsalo para omitir la lógica de anuncios en
            escritorio.
          </>
        ),
        example: {
          lang: "ts",
          title: "isSupported",
          code: `if (!(await AdMob.isSupported())) return
// solo llega aquí en móvil`,
        },
      },
      {
        name: "getStatus",
        signature: "getStatus()",
        returns: "Promise<AdMobStatus>",
        desc: "Instantánea del estado completo del plugin: inicialización, plataforma, modo test, consentimiento, ATT y disponibilidad de cada formato.",
        example: {
          lang: "ts",
          title: "getStatus",
          code: `const status = await AdMob.getStatus()
// { initialized, platform, testing, consentStatus, trackingStatus,
//   interstitialReady, rewardedReady, bannerVisible }`,
        },
      },
      {
        name: "destroy",
        signature: "destroy()",
        returns: "Promise<void>",
        desc: "Limpieza global: libera el banner, el intersticial y el rewarded, elimina los recursos nativos y resetea el estado para poder volver a inicializar.",
        example: {
          lang: "ts",
          title: "destroy",
          code: `await AdMob.destroy() // libera todos los recursos de anuncios`,
        },
      },
    ],
  },
  {
    id: "api-privacidad",
    title: "Privacidad",
    methods: [
      {
        name: "requestConsent",
        signature: "requestConsent()",
        returns: "Promise<ConsentResult>",
        desc: (
          <>
            Ejecuta el flujo de Google UMP: actualiza la información de
            consentimiento y muestra el formulario solo si es necesario.
            Mientras el estado sea <Code>required</Code>, las peticiones de
            anuncios rechazan con <Code>CONSENT_REQUIRED</Code>.
          </>
        ),
        errors: ["UNSUPPORTED_PLATFORM", "NATIVE_ERROR"],
        example: {
          lang: "ts",
          title: "requestConsent",
          code: `const { status } = await AdMob.requestConsent()
if (status === "obtained") {
  // consentimiento listo, los anuncios pueden pedirse
}`,
        },
      },
      {
        name: "getConsentStatus",
        signature: "getConsentStatus()",
        returns: "Promise<ConsentStatus>",
        desc: (
          <>
            Último estado UMP conocido: <Code>unknown</Code>,{" "}
            <Code>required</Code>, <Code>notRequired</Code> u{" "}
            <Code>obtained</Code>.
          </>
        ),
        example: {
          lang: "ts",
          title: "getConsentStatus",
          code: `const status = await AdMob.getConsentStatus()`,
        },
      },
      {
        name: "requestTrackingAuthorization",
        signature: "requestTrackingAuthorization()",
        returns: "Promise<TrackingAuthorizationStatus>",
        desc: (
          <>
            Muestra el prompt de ATT de iOS. En Android y escritorio resuelve{" "}
            <Code>&quot;notAvailable&quot;</Code> sin lanzar error, así que es
            seguro llamarlo sin condiciones. Nunca se solicita de forma
            automática salvo que lo actives en <Code>initialize()</Code>.
          </>
        ),
        example: {
          lang: "ts",
          title: "requestTrackingAuthorization",
          code: `const status = await AdMob.requestTrackingAuthorization()
if (status === "authorized") {
  // el usuario permite el rastreo: mejor eCPM
}`,
        },
      },
      {
        name: "getTrackingAuthorizationStatus",
        signature: "getTrackingAuthorizationStatus()",
        returns: "Promise<TrackingAuthorizationStatus>",
        desc: "Último estado ATT conocido, sin mostrar ningún prompt.",
        example: {
          lang: "ts",
          title: "getTrackingAuthorizationStatus",
          code: `const status = await AdMob.getTrackingAuthorizationStatus()`,
        },
      },
    ],
  },
  {
    id: "api-banner",
    title: "Banner",
    methods: [
      {
        name: "showBanner",
        signature: "showBanner(options?: ShowBannerOptions)",
        returns: "Promise<void>",
        desc: (
          <>
            Carga y muestra un banner nativo. Por defecto{" "}
            <Code>position: &quot;bottom&quot;</Code> y{" "}
            <Code>size: &quot;adaptive&quot;</Code>. La promesa resuelve cuando
            el anuncio está cargado y visible; un evento{" "}
            <Code>banner-failed</Code> significa que nada se adjuntó.
          </>
        ),
        params: [
          { name: "options.adUnitId", type: "string", desc: "Ad Unit ID; si se omite se usa el configurado o el de test." },
          { name: "options.position", type: '"top" | "bottom"', desc: "Borde de la ventana donde se ancla el banner." },
          { name: "options.size", type: "BannerSize", desc: "Uno de los seis tamaños soportados; adaptive por defecto." },
        ],
        errors: ["NOT_INITIALIZED", "INVALID_CONFIGURATION", "INVALID_ARGUMENT", "LOAD_FAILED", "CONSENT_REQUIRED", "UNSUPPORTED_PLATFORM"],
        example: {
          lang: "ts",
          title: "showBanner",
          code: `await AdMob.showBanner({ position: "bottom", size: "adaptive" })`,
        },
      },
      {
        name: "hideBanner",
        signature: "hideBanner()",
        returns: "Promise<void>",
        desc: "Oculta el banner sin destruirlo: puedes volver a mostrarlo con showBanner() sin recargar.",
        errors: ["NOT_INITIALIZED", "UNSUPPORTED_PLATFORM"],
        example: {
          lang: "ts",
          title: "hideBanner",
          code: `await AdMob.hideBanner()`,
        },
      },
      {
        name: "isBannerVisible",
        signature: "isBannerVisible()",
        returns: "Promise<boolean>",
        desc: "true cuando el banner nativo está visible en este momento.",
        example: {
          lang: "ts",
          title: "isBannerVisible",
          code: `const visible = await AdMob.isBannerVisible()`,
        },
      },
      {
        name: "setBannerPosition",
        signature: "setBannerPosition(options: SetBannerPositionOptions)",
        returns: "Promise<void>",
        desc: "Mueve un banner a la posición indicada sin recargar el anuncio.",
        params: [
          { name: "options.position", type: '"top" | "bottom"', required: true, desc: "Nueva posición del banner." },
        ],
        errors: ["INVALID_ARGUMENT", "NOT_INITIALIZED"],
        example: {
          lang: "ts",
          title: "setBannerPosition",
          code: `await AdMob.setBannerPosition({ position: "top" })`,
        },
      },
      {
        name: "destroyBanner",
        signature: "destroyBanner()",
        returns: "Promise<void>",
        desc: "Destruye el banner nativo y libera sus recursos. Llama a showBanner() de nuevo para crear otro.",
        errors: ["NOT_INITIALIZED", "UNSUPPORTED_PLATFORM"],
        example: {
          lang: "ts",
          title: "destroyBanner",
          code: `await AdMob.destroyBanner()`,
        },
      },
    ],
  },
  {
    id: "api-intersticial",
    title: "Intersticial",
    methods: [
      {
        name: "loadInterstitial",
        signature: "loadInterstitial(options?: LoadAdOptions)",
        returns: "Promise<void>",
        desc: "Carga un intersticial; la promesa resuelve cuando el anuncio está listo para mostrarse. Puede tardar segundos en conexiones lentas.",
        params: [
          { name: "options.adUnitId", type: "string", desc: "Ad Unit ID opcional; si se omite se usa el configurado o el de test." },
        ],
        errors: ["NOT_INITIALIZED", "INVALID_CONFIGURATION", "INVALID_ARGUMENT", "LOAD_FAILED", "CONSENT_REQUIRED", "UNSUPPORTED_PLATFORM"],
        example: {
          lang: "ts",
          title: "loadInterstitial",
          code: `await AdMob.loadInterstitial()`,
        },
      },
      {
        name: "showInterstitial",
        signature: "showInterstitial()",
        returns: "Promise<void>",
        desc: (
          <>
            Muestra un intersticial previamente cargado. La promesa resuelve
            cuando el usuario lo cierra. Rechaza con <Code>AD_NOT_READY</Code>{" "}
            si no hay nada cargado.
          </>
        ),
        errors: ["AD_NOT_READY", "SHOW_FAILED", "NOT_INITIALIZED", "CONSENT_REQUIRED", "UNSUPPORTED_PLATFORM"],
        example: {
          lang: "ts",
          title: "showInterstitial",
          code: `if (await AdMob.isInterstitialReady()) {
  await AdMob.showInterstitial()
}`,
        },
      },
      {
        name: "isInterstitialReady",
        signature: "isInterstitialReady()",
        returns: "Promise<boolean>",
        desc: "true cuando hay un intersticial cargado y listo para mostrar.",
        example: {
          lang: "ts",
          title: "isInterstitialReady",
          code: `const ready = await AdMob.isInterstitialReady()`,
        },
      },
      {
        name: "destroyInterstitial",
        signature: "destroyInterstitial()",
        returns: "Promise<void>",
        desc: "Destruye el intersticial cargado, si lo hay.",
        example: {
          lang: "ts",
          title: "destroyInterstitial",
          code: `await AdMob.destroyInterstitial()`,
        },
      },
    ],
  },
  {
    id: "api-rewarded",
    title: "Rewarded",
    methods: [
      {
        name: "loadRewarded",
        signature: "loadRewarded(options?: LoadAdOptions)",
        returns: "Promise<void>",
        desc: "Carga un anuncio rewarded; resuelve cuando está listo para mostrarse.",
        params: [
          { name: "options.adUnitId", type: "string", desc: "Ad Unit ID opcional; si se omite se usa el configurado o el de test." },
        ],
        errors: ["NOT_INITIALIZED", "INVALID_CONFIGURATION", "INVALID_ARGUMENT", "LOAD_FAILED", "CONSENT_REQUIRED", "UNSUPPORTED_PLATFORM"],
        example: {
          lang: "ts",
          title: "loadRewarded",
          code: `await AdMob.loadRewarded()`,
        },
      },
      {
        name: "showRewarded",
        signature: "showRewarded(options?)",
        returns: "Promise<void>",
        desc: (
          <>
            Muestra el rewarded cargado. Resuelve cuando el usuario lo cierra;
            la recompensa llega por el evento{" "}
            <Code>admob://rewarded-earned</Code> desde el callback real del SDK.
          </>
        ),
        errors: ["AD_NOT_READY", "SHOW_FAILED", "NOT_INITIALIZED", "CONSENT_REQUIRED", "UNSUPPORTED_PLATFORM"],
        example: {
          lang: "ts",
          title: "showRewarded",
          code: `if (await AdMob.isRewardedReady()) {
  await AdMob.showRewarded()
}`,
        },
      },
      {
        name: "isRewardedReady",
        signature: "isRewardedReady()",
        returns: "Promise<boolean>",
        desc: "true cuando hay un rewarded cargado y listo para mostrar.",
        example: {
          lang: "ts",
          title: "isRewardedReady",
          code: `const ready = await AdMob.isRewardedReady()`,
        },
      },
      {
        name: "destroyRewarded",
        signature: "destroyRewarded()",
        returns: "Promise<void>",
        desc: "Destruye el rewarded cargado, si lo hay.",
        example: {
          lang: "ts",
          title: "destroyRewarded",
          code: `await AdMob.destroyRewarded()`,
        },
      },
    ],
  },
  {
    id: "api-eventos",
    title: "Eventos",
    methods: [
      {
        name: "on",
        signature: "on<E extends AdMobEventName>(event: E, handler: (payload: AdMobEventMap[E]) => void)",
        returns: "Promise<Unlisten>",
        desc: (
          <>
            Suscribe un handler a un evento del plugin y devuelve una función{" "}
            <Code>unlisten</Code> awaitable. El mapa de eventos es totalmente
            tipado: el payload se infiere del nombre del evento. En móvil usa
            el canal de eventos del plugin; en escritorio, el sistema global.
          </>
        ),
        params: [
          { name: "event", type: "AdMobEventName", required: true, desc: 'Nombre del evento, p. ej. "admob://rewarded-earned".' },
          { name: "handler", type: "(payload) => void", required: true, desc: "Callback tipado según AdMobEventMap." },
        ],
        example: {
          lang: "ts",
          title: "on",
          code: `const unlisten = await AdMob.on("admob://rewarded-earned", ({ payload }) => {
  console.log("+" + payload.amount, payload.type)
})

// para desuscribirse:
// await unlisten()`,
        },
      },
    ],
  },
]

function MethodCard({ method }: { method: ApiMethod }) {
  return (
    <article
      id={`method-${method.name}`}
      className="scroll-mt-24 rounded-xl border bg-card transition-colors hover:border-amber-500/30"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3 sm:px-5">
        <code className="font-mono text-[13px] sm:text-sm">
          <span className="font-semibold text-foreground">AdMob.</span>
          <span className="font-semibold text-amber-600 dark:text-amber-400">{method.name}</span>
          <span className="text-muted-foreground">({method.signature.slice(method.name.length + 1)}</span>
        </code>
        <code className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          → {method.returns}
        </code>
      </div>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <p className="text-sm leading-relaxed text-muted-foreground">{method.desc}</p>
        {method.params ? <ParamTable rows={method.params} /> : null}
        {method.errors ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Errores
            </span>
            {method.errors.map((error) => (
              <code
                key={error}
                className="rounded-md border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 font-mono text-[11px] text-destructive"
              >
                {error}
              </code>
            ))}
          </div>
        ) : null}
        {method.example ? (
          <CodeBlock lang={method.example.lang} code={method.example.code} title={method.example.title} dense />
        ) : null}
      </div>
    </article>
  )
}

export function ApiReferenceSection() {
  return (
    <Section
      id="api"
      eyebrow="Referencia"
      title="API pública"
      lead={
        <>
          Los 23 métodos del objeto <Code>AdMob</Code>, agrupados por área. Todos
          son seguros de llamar sin condiciones: en escritorio, las operaciones
          de anuncios rechazan con <Code>UNSUPPORTED_PLATFORM</Code> mientras el
          núcleo (initialize, configure, getStatus, destroy y consultas de
          estado) sigue funcionando.
        </>
      }
    >
      <div className="space-y-10">
        {API_GROUPS.map((group) => (
          <div key={group.id} id={group.id} className="scroll-mt-24 space-y-4">
            <h3 className="flex items-center gap-3 text-base font-semibold tracking-tight">
              <span className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-amber-600 dark:text-amber-400">
                {group.title}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </h3>
            <div className="space-y-4">
              {group.methods.map((method) => (
                <MethodCard key={method.name} method={method} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */

interface EventRow {
  name: string
  payloadType: string
  fields: string
}

const EVENT_GROUPS: { id: string; label: string; rows: EventRow[] }[] = [
  {
    id: "sistema",
    label: "Sistema",
    rows: [
      {
        name: "admob://initialized",
        payloadType: "InitializedEvent",
        fields: "platform, testing",
      },
      {
        name: "admob://consent-changed",
        payloadType: "ConsentChangedEvent",
        fields: "status",
      },
      {
        name: "admob://tracking-authorization-changed",
        payloadType: "TrackingAuthorizationChangedEvent",
        fields: "status",
      },
    ],
  },
  {
    id: "banner",
    label: "Banner",
    rows: [
      { name: "admob://banner-loaded", payloadType: "AdLoadedEvent", fields: "adUnitId" },
      {
        name: "admob://banner-failed",
        payloadType: "AdErrorEvent",
        fields: "adUnitId?, code?, message, domain?",
      },
      { name: "admob://banner-opened", payloadType: "AdEvent", fields: "adUnitId?" },
      { name: "admob://banner-clicked", payloadType: "AdEvent", fields: "adUnitId?" },
      { name: "admob://banner-impression", payloadType: "AdEvent", fields: "adUnitId?" },
      { name: "admob://banner-closed", payloadType: "AdEvent", fields: "adUnitId?" },
    ],
  },
  {
    id: "intersticial",
    label: "Intersticial",
    rows: [
      { name: "admob://interstitial-loaded", payloadType: "AdLoadedEvent", fields: "adUnitId" },
      {
        name: "admob://interstitial-failed",
        payloadType: "AdErrorEvent",
        fields: "adUnitId?, code?, message, domain?, stage",
      },
      { name: "admob://interstitial-opened", payloadType: "AdEvent", fields: "adUnitId?" },
      { name: "admob://interstitial-impression", payloadType: "AdEvent", fields: "adUnitId?" },
      { name: "admob://interstitial-clicked", payloadType: "AdEvent", fields: "adUnitId?" },
      { name: "admob://interstitial-closed", payloadType: "AdEvent", fields: "adUnitId?" },
    ],
  },
  {
    id: "rewarded",
    label: "Rewarded",
    rows: [
      { name: "admob://rewarded-loaded", payloadType: "AdLoadedEvent", fields: "adUnitId" },
      {
        name: "admob://rewarded-failed",
        payloadType: "AdErrorEvent",
        fields: "adUnitId?, code?, message, domain?, stage",
      },
      { name: "admob://rewarded-opened", payloadType: "AdEvent", fields: "adUnitId?" },
      { name: "admob://rewarded-impression", payloadType: "AdEvent", fields: "adUnitId?" },
      { name: "admob://rewarded-clicked", payloadType: "AdEvent", fields: "adUnitId?" },
      {
        name: "admob://rewarded-earned",
        payloadType: "RewardEarnedEvent",
        fields: "adUnitId?, amount, type",
      },
      { name: "admob://rewarded-closed", payloadType: "AdEvent", fields: "adUnitId?" },
    ],
  },
]

export function EventsSection() {
  return (
    <Section
      id="eventos"
      eyebrow="Referencia"
      title="Eventos"
      lead={
        <>
          Los 22 eventos del plugin, con nombres estables y payloads
          estructurados. Suscríbete con <Code>AdMob.on(evento, handler)</Code>{" "}
          antes de inicializar para no perderte ninguno. El campo{" "}
          <Code>stage</Code> distingue fallos de carga (<Code>&quot;load&quot;</Code>)
          de fallos de muestra (<Code>&quot;show&quot;</Code>) — los eventos de
          banner lo omiten.
        </>
      }
    >
      <Tabs defaultValue={EVENT_GROUPS[0].id} className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1 sm:w-auto">
          {EVENT_GROUPS.map((group) => (
            <TabsTrigger key={group.id} value={group.id} className="data-[state=active]:bg-background">
              {group.label}
              <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                {group.rows.length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {EVENT_GROUPS.map((group) => (
          <TabsContent key={group.id} value={group.id} className="mt-4">
            <DataTable
              minWidth="640px"
              headers={["Evento", "Tipo de payload", "Campos"]}
              rows={group.rows.map((row) => [
                <code
                  key={row.name}
                  className="whitespace-nowrap font-mono text-[12.5px] font-medium text-amber-700 dark:text-amber-400"
                >
                  {row.name}
                </code>,
                <code key={`${row.name}-t`} className="whitespace-nowrap font-mono text-[12.5px] text-foreground">
                  {row.payloadType}
                </code>,
                <code key={`${row.name}-f`} className="font-mono text-[12px] text-muted-foreground">
                  {row.fields}
                </code>,
              ])}
            />
          </TabsContent>
        ))}
      </Tabs>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

const TYPES_SNIPPET = `// Configuración — misma forma que "plugins > ad2mob" en tauri.conf.json
export interface AdMobConfig {
  appId?: string              // App ID genérico
  androidAppId?: string       // prioridad sobre appId en Android
  iosAppId?: string           // prioridad sobre appId en iOS
  isTesting?: boolean         // resuelve los test IDs oficiales de Google
  initializeOnStartup?: boolean
  requestTrackingAuthorization?: boolean // solo iOS, tras initialize
  automaticallyRequestConsent?: boolean  // por defecto: true
  debug?: boolean             // logs detallados; sin datos personales
}

export interface AdUnitIds {
  banner?: string
  interstitial?: string
  rewarded?: string
}

export interface ShowBannerOptions {
  adUnitId?: string
  position?: BannerPosition   // "top" | "bottom"
  size?: BannerSize
}

export interface LoadAdOptions {
  adUnitId?: string           // si se omite: configure() → test IDs
}

// Instantánea de estado que devuelve getStatus()
export interface AdMobStatus {
  initialized: boolean
  platform: AdMobPlatform
  testing: boolean
  consentStatus: ConsentStatus
  trackingStatus: TrackingAuthorizationStatus
  interstitialReady: boolean
  rewardedReady: boolean
  bannerVisible: boolean
}

// Recompensa real entregada por el SDK en admob://rewarded-earned
export interface Reward {
  amount: number
  type: string
}

// Cada método rechaza con un AdMobError (subclase de Error) con "code" estable
export class AdMobError extends Error {
  readonly code: AdMobErrorCode
}

export function isAdMobError(error: unknown): error is AdMobError`

const UNION_TYPES: [string, string][] = [
  ["BannerPosition", '"top" | "bottom"'],
  [
    "BannerSize",
    '"banner" | "largeBanner" | "mediumRectangle" | "fullBanner" | "leaderboard" | "adaptive"',
  ],
  ["ConsentStatus", '"unknown" | "required" | "notRequired" | "obtained"'],
  [
    "TrackingAuthorizationStatus",
    '"notDetermined" | "restricted" | "denied" | "authorized" | "notAvailable"',
  ],
  ["AdMobPlatform", '"android" | "ios" | "windows" | "macos" | "linux"'],
  [
    "AdMobErrorCode",
    "NOT_INITIALIZED · AD_NOT_READY · LOAD_FAILED · SHOW_FAILED · INVALID_CONFIGURATION · INVALID_ARGUMENT · CONSENT_REQUIRED · UNSUPPORTED_PLATFORM · NATIVE_ERROR",
  ],
]

export function TypesSection() {
  return (
    <Section
      id="tipos"
      eyebrow="Referencia"
      title="Tipos"
      lead={
        <>
          Cada tipo público refleja uno a uno los modelos de Rust{" "}
          (<Code>src/models.rs</Code>) y forma parte de la API estable del
          plugin. Estos son los principales; el resto se exporta desde{" "}
          <Code>tauri-plugin-ad2mob</Code>.
        </>
      }
    >
      <CodeBlock lang="ts" title="types.ts (extracto)" code={TYPES_SNIPPET} />
      <DataTable
        minWidth="640px"
        headers={["Unión de literales", "Valores"]}
        rows={UNION_TYPES.map(([name, values]) => [
          <code key={name} className="whitespace-nowrap font-mono text-[13px] font-semibold text-foreground">
            {name}
          </code>,
          <code key={`${name}-v`} className="font-mono text-[12px] leading-relaxed text-muted-foreground">
            {values}
          </code>,
        ])}
      />
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Errores                                                             */
/* ------------------------------------------------------------------ */

const ERROR_SNIPPET = `import { AdMob, isAdMobError } from "tauri-plugin-ad2mob"

try {
  await AdMob.showInterstitial()
} catch (error) {
  if (isAdMobError(error) && error.code === "AD_NOT_READY") {
    await AdMob.loadInterstitial()
  }
}`

const ERROR_ROWS: [string, string, string][] = [
  ["NOT_INITIALIZED", "Operación de anuncios antes de initialize().", "Inicializa el plugin al arrancar la app."],
  ["INVALID_CONFIGURATION", "Falta o es inválido el App ID, un Ad Unit ID o la configuración de plataforma.", "Revisa el manifest / Info.plist y configure()."],
  ["INVALID_ARGUMENT", "Argumentos malformados.", "Revisa tipos y valores de las opciones."],
  ["AD_NOT_READY", "show*() sin anuncio cargado.", "Carga primero y recarga tras cada cierre."],
  ["LOAD_FAILED", "El SDK no pudo cargar el anuncio.", "Mira el evento *-failed y reintenta con backoff."],
  ["SHOW_FAILED", "El SDK no pudo presentar el anuncio.", "Mira el evento *-failed (stage: show) y reintenta."],
  ["CONSENT_REQUIRED", "El estado UMP es required.", "Ejecuta requestConsent() y completa el formulario."],
  ["UNSUPPORTED_PLATFORM", "API de móvil usada en escritorio.", "Filtra con isSupported() si quieres omitir en silencio."],
  ["NATIVE_ERROR", "Cualquier otro error reportado por la capa nativa.", "Inspecciona message y los eventos asociados."],
]

export function ErrorsSection() {
  return (
    <Section
      id="errores"
      eyebrow="Referencia"
      title="Errores"
      lead={
        <>
          Cada método lanza un <Code>AdMobError</Code> — una subclase de{" "}
          <Code>Error</Code> — con un campo <Code>code</Code> estable y
          compartido con el enum de errores de Rust. Usa{" "}
          <Code>isAdMobError()</Code> como type guard.
        </>
      }
    >
      <CodeBlock lang="ts" title="Manejo de errores" code={ERROR_SNIPPET} />
      <DataTable
        minWidth="680px"
        headers={["Código", "Cuándo ocurre", "Qué hacer"]}
        rows={ERROR_ROWS.map(([code, when, action]) => [
          <code key={code} className="whitespace-nowrap font-mono text-[12.5px] font-semibold text-destructive">
            {code}
          </code>,
          <span key={`${code}-w`} className="text-[13px] text-muted-foreground">
            {when}
          </span>,
          <span key={`${code}-a`} className="text-[13px] text-muted-foreground">
            {action}
          </span>,
        ])}
      />
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Pruebas                                                             */
/* ------------------------------------------------------------------ */

const TEST_ROWS: [string, string, string][] = [
  ["Banner", "ca-app-pub-3940256099942544/6300978111", "ca-app-pub-3940256099942544/2934735716"],
  ["Intersticial", "ca-app-pub-3940256099942544/1033173712", "ca-app-pub-3940256099942544/441146891"],
  ["Rewarded", "ca-app-pub-3940256099942544/5224354917", "ca-app-pub-3940256099942544/1717083536"],
]

export function TestingSection() {
  return (
    <Section
      id="pruebas"
      eyebrow="Producción"
      title="Pruebas y anuncios de test"
      lead={
        <>
          Con <Code>isTesting: true</Code>, los Ad Unit IDs que falten se
          resuelven a los oficiales de Google. Estos son los IDs explícitos si
          prefieres fijarlos a mano (App IDs de test: Android{" "}
          <Code>~3347511713</Code>, iOS <Code>~1458002511</Code>).
        </>
      }
    >
      <DataTable
        minWidth="640px"
        headers={["Formato", "Android", "iOS"]}
        rows={TEST_ROWS.map(([format, android, ios]) => [
          <span key={format} className="font-medium text-foreground">
            {format}
          </span>,
          <code key={`${format}-a`} className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
            {android}
          </code>,
          <code key={`${format}-i`} className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
            {ios}
          </code>,
        ])}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Callout variant="tip" title="Emuladores y simuladores">
          Los emuladores de Android funcionan con los test IDs; el simulador de
          iOS también. Para validación final necesitas dispositivo real: el
          comportamiento de UMP y el prompt de ATT pueden diferir entre
          simulador y hardware.
        </Callout>
        <Callout variant="warn" title="Nunca hagas clic en tus propios anuncios">
          Los test IDs son solo para desarrollo y pruebas automatizadas. Hacer
          clic en anuncios de producción propios viola las políticas de AdMob y
          puede supender tu cuenta.
        </Callout>
      </div>
      <Callout title="Dispositivos de prueba con anuncios reales">
        En dispositivos Android con Google Play services puedes registrar tu
        dispositivo como test device (<Code>testDeviceIds</Code> via{" "}
        <Code>MobileAds.setRequestConfiguration</Code>) para recibir anuncios de
        prueba con tus Ad Unit IDs reales.
      </Callout>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Escritorio                                                          */
/* ------------------------------------------------------------------ */

const DESKTOP_ROWS: [string, string][] = [
  ["initialize()", "No-op correcto: el estado se registra y se emite admob://initialized."],
  ["configure(), getStatus(), isSupported() y consultas de estado", "Funcionan con normalidad."],
  ["requestTrackingAuthorization()", "Resuelve notAvailable sin lanzar error."],
  ["requestConsent() y toda operación de anuncios", "Rechazan con UNSUPPORTED_PLATFORM."],
  ["destroy()", "No-op correcto."],
]

export function DesktopSection() {
  return (
    <Section
      id="escritorio"
      eyebrow="Producción"
      title="Comportamiento en escritorio"
      lead={
        <>
          El crate compila para Windows, macOS y Linux sin enlazar el runtime de
          WebView de escritorio: añadir el plugin no cambia las dependencias de
          tu build de escritorio. Toda la superficie móvil degrada de forma
          controlada.
        </>
      }
    >
      <DataTable
        minWidth="560px"
        headers={["API", "Comportamiento en Windows / macOS / Linux"]}
        rows={DESKTOP_ROWS.map(([api, behavior]) => [
          <code key={api} className="whitespace-nowrap font-mono text-[12.5px] font-medium text-foreground">
            {api}
          </code>,
          <span key={`${api}-b`} className="text-[13px] text-muted-foreground">
            {behavior}
          </span>,
        ])}
      />
      <Callout variant="tip" title="Patrón recomendado">
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px]">
{`if (await AdMob.isSupported()) {
  await AdMob.initialize({ isTesting: true })
}`}
        </pre>
      </Callout>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQ_ITEMS: { question: string; answer: ReactNode }[] = [
  {
    question: "El anuncio no carga o devuelve no-fill",
    answer: (
      <>
        Los test IDs devuelven no-fill de forma ocasional: reintenta o cambia de
        formato. En producción, revisa la consola de AdMob (estado de la app y
        del ad unit, tráfico) y verifica que el dispositivo alcanza{" "}
        <Code>googleads.g.doubleclick.net</Code>.
      </>
    ),
  },
  {
    question: "INVALID_CONFIGURATION en Android",
    answer: (
      <>
        Falta el <Code>meta-data</Code>{" "}
        <Code>com.google.android.gms.ads.APPLICATION_ID</Code> en el app
        manifest. Añádelo dentro de <Code>&lt;application&gt;</Code> (ver
        Instalación → Android) y reconstruye.
      </>
    ),
  },
  {
    question: "INVALID_CONFIGURATION en iOS",
    answer: (
      <>
        Falta <Code>GADApplicationIdentifier</Code> en el{" "}
        <Code>Info.plist</Code> — el SDK de GoogleMobileAds aborta sin él.
      </>
    ),
  },
  {
    question: "Las peticiones se rechazan con CONSENT_REQUIRED",
    answer: (
      <>
        El estado UMP es <Code>required</Code>. Llama a{" "}
        <Code>AdMob.requestConsent()</Code> (o mantén{" "}
        <Code>automaticallyRequestConsent: true</Code>) y completa el formulario
        una vez: el estado queda cacheado por dispositivo por el SDK de UMP.
      </>
    ),
  },
  {
    question: "El prompt de ATT no aparece en iOS",
    answer: (
      <>
        ATT debe solicitarse con la app activa y solo se muestra una vez por
        instalación (reinstala o restablece los ajustes de privacidad del
        simulador para verlo de nuevo). Comprueba que{" "}
        <Code>NSUserTrackingUsageDescription</Code> existe en el{" "}
        <Code>Info.plist</Code>.
      </>
    ),
  },
  {
    question: "El banner tapa la UI de mi app",
    answer: (
      <>
        El banner nativo flota sobre el borde solicitado del WebView; este no se
        redimensiona. Reserva el espacio equivalente en tu layout (por ejemplo,
        un padding inferior igual a la altura del banner) — ver la sección de
        Banner.
      </>
    ),
  },
  {
    question: "El banner no se ve",
    answer: (
      <>
        <Code>showBanner()</Code> solo resuelve después de que el anuncio se
        cargue: un evento <Code>banner-failed</Code> significa que no se adjuntó
        nada. Comprueba también que no llamaste a <Code>hideBanner()</Code>{" "}
        antes, y que las safe areas no están consumiendo el banner (por ejemplo,
        barras de navegación por gestos en Android).
      </>
    ),
  },
  {
    question: "AD_NOT_READY en intersticial o rewarded",
    answer: (
      <>
        Los anuncios deben cargarse antes de mostrarse y se consumen tras cada
        show: recarga después de cada evento <Code>*-closed</Code>. En
        conexiones lentas la carga puede tardar segundos — la promesa de{" "}
        <Code>load*</Code> resuelve al completarse.
      </>
    ),
  },
  {
    question: "La recompensa no llega",
    answer: (
      <>
        La recompensa solo se emite desde{" "}
        <Code>admob://rewarded-earned</Code>, el callback real del SDK mientras
        el anuncio se está viendo. Cerrar pronto el anuncio, peculariedades de
        no-fill o adaptadores de mediación pueden omitirla legítimamente — nunca
        otorgues recompensas desde <Code>rewarded-closed</Code>.
      </>
    ),
  },
  {
    question: "UNSUPPORTED_PLATFORM al ejecutar en escritorio",
    answer: (
      <>
        Es el comportamiento esperado: los anuncios solo existen en móvil.
        Filtra las llamadas con <Code>AdMob.isSupported()</Code> si prefieres
        omitirlas en silencio.
      </>
    ),
  },
]

export function FaqSection() {
  return (
    <Section
      id="faq"
      eyebrow="Producción"
      title="Solución de problemas"
      lead="Los doce síntomas más comunes, su causa y su solución rápida."
    >
      <Accordion type="single" collapsible className="rounded-xl border bg-card">
        {FAQ_ITEMS.map((item, index) => (
          <AccordionItem key={item.question} value={`item-${index}`}>
            <AccordionTrigger className="px-5 text-left text-[15px] font-medium hover:text-foreground hover:no-underline">
              {item.question}
            </AccordionTrigger>
            <AccordionContent className="px-5 text-sm leading-relaxed text-muted-foreground">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Limitaciones                                                        */
/* ------------------------------------------------------------------ */

const LIMITATIONS = [
  "El banner superpone el WebView en lugar de redimensionarlo: reserva espacio en tu UI.",
  "Un showBanner mientras otra carga está en curso reemplaza el banner anterior; la promesa sustituida rechaza con LOAD_FAILED.",
  "Los anuncios a pantalla completa de iOS conservan su promesa de show pendiente a través de destroy(), para que el SDK pueda reportar el cierre: la promesa siempre termina resolviéndose o rechazándose.",
  "La mediación se soporta en la medida del SDK base de Google Mobile Ads; el plugin no configura adaptadores por red.",
  "El código nativo Android/iOS está validado por revisión y tests unitarios de lógica pura: ejecuta la app de ejemplo (examples/admob-demo) en hardware real antes de publicar.",
]

export function LimitationsSection() {
  return (
    <Section
      id="limitaciones"
      eyebrow="Producción"
      title="Limitaciones conocidas"
      lead="Documentadas con honestidad para que no te sorprendan en producción."
    >
      <ul className="space-y-3">
        {LIMITATIONS.map((limitation, index) => (
          <li key={index} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
            <span
              aria-hidden
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500/70"
            />
            {limitation}
          </li>
        ))}
      </ul>
    </Section>
  )
}
