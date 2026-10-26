import { createI18n } from 'vue-i18n'
import { I18N_MESSAGES } from './messages'

const i18n = createI18n({
    legacy: false, // you must set `false`, to use Composition API
    locale: 'en',
    fallbackLocale: 'en',
    messages: I18N_MESSAGES,
    missingWarn: false,
    fallbackWarn: false,
})

export default i18n;
