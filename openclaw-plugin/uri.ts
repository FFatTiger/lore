const DEFAULT_DOMAIN = "core";

export function trimSlashes(value: any) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

export function parseMemoryUri(value: any, fallbackDomain = DEFAULT_DOMAIN) {
  const raw = String(value || "").trim();
  if (!raw) return { domain: fallbackDomain, path: "" };
  if (raw.includes("://")) {
    const [domainPart, pathPart] = raw.split("://", 2);
    return { domain: domainPart.trim() || fallbackDomain, path: trimSlashes(pathPart) };
  }
  return { domain: fallbackDomain, path: trimSlashes(raw) };
}

export function sameLocator(a: any, b: any) {
  return a?.domain === b?.domain && a?.path === b?.path;
}

export function resolveMemoryLocator(params: any, {
  defaultDomain = DEFAULT_DOMAIN,
  domainKey = "domain",
  pathKey = "path",
  uriKey = "uri",
  allowEmptyPath = true,
  label = "path",
}: any = {}) {
  const explicitDomain = typeof params?.[domainKey] === "string" && params[domainKey].trim()
    ? params[domainKey].trim()
    : "";
  const fallbackDomain = explicitDomain || defaultDomain;
  const rawPath = typeof params?.[pathKey] === "string" ? params[pathKey].trim() : "";
  const rawUri = typeof params?.[uriKey] === "string" ? params[uriKey].trim() : "";

  if (rawPath.includes("://")) {
    throw new Error(`Invalid ${pathKey}: expected a relative path inside ${domainKey}, got a full URI. Pass ${uriKey}="domain://path" instead.`);
  }

  const locatorFromPath = rawPath
    ? { domain: fallbackDomain, path: trimSlashes(rawPath) }
    : { domain: fallbackDomain, path: "" };
  const locatorFromUri = rawUri ? parseMemoryUri(rawUri, fallbackDomain) : null;

  if (locatorFromUri && rawPath && !sameLocator(locatorFromUri, locatorFromPath)) {
    throw new Error(`Conflicting ${uriKey} and ${pathKey}: ${locatorFromUri.domain}://${locatorFromUri.path} vs ${locatorFromPath.domain}://${locatorFromPath.path}`);
  }
  if (locatorFromUri && explicitDomain && locatorFromUri.domain !== explicitDomain) {
    throw new Error(`Conflicting ${uriKey} and ${domainKey}: ${locatorFromUri.domain} vs ${explicitDomain}`);
  }

  const locator = locatorFromUri || locatorFromPath;
  if (!allowEmptyPath && !locator.path) {
    throw new Error(`${label} is required. Pass ${uriKey}="domain://path" or ${pathKey}="relative/path".`);
  }
  return locator;
}

export function splitParentPathAndTitle(path: string) {
  const cleanPath = trimSlashes(path);
  const segments = cleanPath.split("/").filter(Boolean);
  if (segments.length === 0) return { parentPath: "", title: "" };
  return {
    parentPath: segments.slice(0, -1).join("/"),
    title: segments[segments.length - 1],
  };
}
