import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

const nextConfig: NextConfig = {
  i18n: {
    locales: ['en', 'fr'],
    defaultLocale: 'en',
  },
};

export default withNextIntl(nextConfig);
