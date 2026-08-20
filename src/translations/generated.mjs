const generatedTranslations = {
  "default": {}
};

function defaultTranslationText(key) {
  return String(key ?? '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, char => char.toUpperCase());
}

function createFastUITranslations() {
  return {
    locale: 'default',
    translations: {},
    load(locale, entries) {
      this.translations[locale] = {...(this.translations[locale] ?? {}), ...entries};
      return this;
    },
    setLocale(locale) {
      this.locale = locale;
      return this;
    },
    t(key, fallback) {
      return this.translations[this.locale]?.[key]
        ?? this.translations.en?.[key]
        ?? fallback
        ?? defaultTranslationText(key);
    },
  };
}

export function installFastUITranslations(target = globalThis) {
  const store = target.fastUITranslations ?? createFastUITranslations();
  if (typeof store.load !== 'function') store.load = createFastUITranslations().load;
  if (typeof store.setLocale !== 'function') store.setLocale = createFastUITranslations().setLocale;
  if (typeof store.t !== 'function') store.t = createFastUITranslations().t;
  store.locale = store.locale ?? 'default';
  store.translations = store.translations ?? {};
  store.load('default', generatedTranslations.default ?? {});
  target.fastUITranslations = store;
  return store;
}
