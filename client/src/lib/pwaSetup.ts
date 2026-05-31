type SwStatusCallback = (status: "registered" | "unsupported" | "error", error?: string) => void;

export function registerServiceWorker(onStatus?: SwStatusCallback) {
  if (typeof window === 'undefined') return;

  if (!('serviceWorker' in navigator)) {
    onStatus?.("unsupported", "Service workers are not supported in this browser");
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        onStatus?.("registered");

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (installing) {
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                // New content available — could show a toast/notification
                console.info('SW: new version available');
              }
            });
          }
        });
      })
      .catch((err: Error) => {
        onStatus?.("error", err.message);
        console.error('SW registration failed:', err.message);
      });
  });
}

export async function requestPushPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      return true;
    }
    console.warn('SW: notification permission denied');
    return false;
  } catch (err) {
    console.error('SW: error requesting notification permission:', err);
    return false;
  }
}
