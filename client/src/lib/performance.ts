import { onCLS, onINP, onLCP, onTTFB, onFCP, Metric } from 'web-vitals';

export function reportWebVitals(metric: Metric) {
  const body = JSON.stringify(metric);
  const url = '/api/analytics/vitals';

  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, body);
  } else {
    fetch(url, { body, method: 'POST', keepalive: true }).catch(() => {});
  }
}

export function initPerformanceMonitoring() {
  if (typeof window !== 'undefined') {
    onCLS(reportWebVitals);
    onINP(reportWebVitals);
    onLCP(reportWebVitals);
    onTTFB(reportWebVitals);
    onFCP(reportWebVitals);
  }
}

