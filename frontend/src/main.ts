import { loadTranslations } from '@angular/localize';
import { detectLanguage, setActiveLanguage } from './app/core/i18n/language';

const lang = detectLanguage();
setActiveLanguage(lang);
document.documentElement.lang = lang;
if (lang === 'it') loadTranslations((await import('./locale/messages.it.json')).default.translations);

// The app is imported only now: modules translate their `$localize` strings when first evaluated.
const [{ bootstrapApplication }, { appConfig }, { App }] = await Promise.all([
  import('@angular/platform-browser'),
  import('./app/app.config'),
  import('./app/app'),
]);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
