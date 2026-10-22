import { loadTranslations } from '@angular/localize';
import { setActiveLanguage } from './app/core/i18n/language';
import it from './locale/messages.it.json';

/**
 * Server-rendered pages (shared results) are rendered in Italian, the main audience.
 * Translations are global to the process, so the server can only render one language;
 * a browser in another language renders the page again instead of hydrating it (app.config.ts).
 * Imported first by main.server.ts so it runs before any module with `$localize` strings.
 */
setActiveLanguage('it');
loadTranslations(it.translations);
