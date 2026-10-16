const WORKER_URL = "/sw.js";

export async function registerProductionServiceWorker() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
    return registration;
  } catch {
    return null;
  }
}
