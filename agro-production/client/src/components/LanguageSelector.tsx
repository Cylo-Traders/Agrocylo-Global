'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useTransition } from 'react'

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
]

export function LanguageSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  
  const currentLocale = pathname?.split('/')[1] || 'en'
  const [selectedLocale, setSelectedLocale] = useState(currentLocale)

  const handleLanguageChange = (locale: string) => {
    setSelectedLocale(locale)
    const segments = pathname?.split('/').filter(Boolean) || []
    const newPath = segments[0] === 'en' || segments[0] === 'fr' 
      ? `/${locale}/${segments.slice(1).join('/')}`
      : `/${locale}${pathname}`
    
    startTransition(() => {
      router.push(newPath)
    })
  }

  return (
    <div className="relative inline-block">
      <label htmlFor="language-selector" className="sr-only">
        Select language
      </label>
      <select
        id="language-selector"
        value={selectedLocale}
        onChange={(e) => handleLanguageChange(e.target.value)}
        disabled={isPending}
        className="appearance-none bg-surface border border-border rounded-lg px-3 py-2 pr-8 text-sm text-foreground hover:bg-background disabled:opacity-50 transition-colors cursor-pointer"
        aria-label="Change language"
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.name}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  )
}
