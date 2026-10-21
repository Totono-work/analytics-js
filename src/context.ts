export type AnalyticsContext = {
  /** Active app language. Omit to use the browser preference. */
  language?: string;
  /** Active app appearance. Omit to use the system preference. */
  colorScheme?: "light" | "dark";
};
export type DeviceContext = AnalyticsContext & {
  deviceType?: "phone" | "tablet" | "desktop" | "unknown";
  deviceModel?: string;
  osName?: string;
  osVersion?: string;
  screenWidth?: number;
  screenHeight?: number;
  screenScale?: number;
};
export function contextOverrides(value: AnalyticsContext): AnalyticsContext {
  const result: AnalyticsContext = {};
  if (value.language !== undefined) {
    try {
      if (!value.language || value.language.length > 80) throw Error();
      result.language = Intl.getCanonicalLocales(value.language)[0];
      if (!result.language) throw Error();
    } catch { throw Error("invalid_language"); }
  }
  if (value.colorScheme !== undefined) {
    if (value.colorScheme !== "light" && value.colorScheme !== "dark")
      throw Error("invalid_color_scheme");
    result.colorScheme = value.colorScheme;
  }
  return result;
}

/** No high-entropy client hints, model probing, or asynchronous work. */
export function deviceContext(): DeviceContext {
  const result: DeviceContext = {};
  try {
    const nav = globalThis.navigator;
    const ua = nav?.userAgent || "";
    const hints = (nav as Navigator & {
      userAgentData?: { platform?: string; mobile?: boolean };
    } | undefined)?.userAgentData;
    const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
    result.deviceType = ipad || /Tablet|Android(?!.*Mobile)/i.test(ua) ? "tablet"
      : /iPhone|iPod|Mobile/i.test(ua) || hints?.mobile ? "phone"
      : /Windows|Macintosh|X11|CrOS|Linux/.test(ua) ? "desktop" : "unknown";
    if (ipad || /iPhone|iPod/.test(ua)) {
      result.osName = "iOS";
      const version = ua.match(/(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/)?.[1];
      if (version) result.osVersion = version.replace(/_/g, ".");
    } else if (hints?.platform && hints.platform.length <= 80) result.osName = hints.platform;
    else if (/Android/.test(ua)) result.osName = "Android";
    else if (/Windows/.test(ua)) result.osName = "Windows";
    else if (/CrOS/.test(ua)) result.osName = "Chrome OS";
    else if (/Macintosh/.test(ua)) result.osName = "macOS";
    else if (/Linux/.test(ua)) result.osName = "Linux";
    // Desktop/Android UA versions are often frozen, so do not infer them.
  } catch { /* Device data may be unavailable in restricted contexts. */ }
  try { Object.assign(result, contextOverrides({ language: globalThis.navigator?.language })); }
  catch { /* Invalid or inaccessible locale is omitted. */ }
  try {
    if (typeof globalThis.matchMedia === "function")
      result.colorScheme = globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch { /* Appearance may be unavailable. */ }
  for (const [key, read, max] of [
    ["screenWidth", () => globalThis.screen?.width, 100_000],
    ["screenHeight", () => globalThis.screen?.height, 100_000],
    ["screenScale", () => globalThis.devicePixelRatio, 100],
  ] as const) {
    try {
      const value = read();
      if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max)
        result[key] = value;
    } catch { /* Screen data may be unavailable. */ }
  }
  return result;
}
