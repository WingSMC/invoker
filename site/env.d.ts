declare module "*.css";
interface ImportMetaEnv {
  readonly VITE_INVOKER_GZIP_KB: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
