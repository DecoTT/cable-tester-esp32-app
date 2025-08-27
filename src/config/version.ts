// Configuración de versión de la aplicación
export const APP_VERSION = {
  version: '1.0.14',
  buildDate: '2025-08-06',
  revision: 'rev-2408062',
  environment: import.meta.env.MODE || 'development'
};

// Función para obtener la versión completa formateada
export const getVersionString = () => {
  const { version, revision, environment } = APP_VERSION;
  const envTag = environment === 'production' ? '' : ` (${environment})`;
  return `v${version}-${revision}${envTag}`;
};

// Función para obtener información detallada de la versión
export const getVersionInfo = () => {
  return {
    ...APP_VERSION,
    fullVersion: getVersionString(),
    timestamp: new Date().toISOString()
  };
};