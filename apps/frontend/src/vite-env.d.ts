/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YOUTUBE_API_PASS: string;
  readonly VITE_YOUTUBE_API_BASE_URL: string;
  readonly VITE_FILE_SYNC_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __PWA_TEST_MODE__: boolean;
