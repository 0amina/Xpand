/// <reference types="vite/client" />

/** Typed `import.meta.env` for the app's own variables. See `.env.example`. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Development only — ignored inside Telegram, where initData supplies the id. */
  readonly VITE_DEV_TELEGRAM_ID?: string;
  readonly VITE_DEV_FIRST_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
