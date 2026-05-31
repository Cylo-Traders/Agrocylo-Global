import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

const locales = ['en', 'fr', 'es'] as const;

export default getRequestConfig(async ({ locale }) => {
  const activeLocale = locale || 'en';
  if (!locales.includes(activeLocale as typeof locales[number])) notFound();

  return {
    locale: activeLocale,
    messages: (await import(`../../public/locales/${activeLocale}/common.json`)).default
  };
});
