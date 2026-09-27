// Versión de la app de PC. Independiente de la del firmware (FW_VERSION en config.h)
// y del contrato JSON (api=1). El bridge rechaza testers con otra "api".
export const APP_VERSION = {
  version: "0.1.0",
  phase: "Fase 0-1 — base + conexión",
  environment: import.meta.env.MODE || "development",
};

export const getVersionString = () => {
  const env = APP_VERSION.environment === "production" ? "" : ` (${APP_VERSION.environment})`;
  return `v${APP_VERSION.version}${env}`;
};
