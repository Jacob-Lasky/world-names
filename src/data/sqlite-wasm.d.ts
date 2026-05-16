// @sqlite.org/sqlite-wasm doesn't ship TypeScript types. We declare only
// the surface we use in db.ts; everything else stays opaque.
declare module '@sqlite.org/sqlite-wasm' {
  type InitOptions = {
    print?: (...args: unknown[]) => void;
    printErr?: (...args: unknown[]) => void;
  };
  function sqlite3InitModule(opts?: InitOptions): Promise<unknown>;
  export default sqlite3InitModule;
}
