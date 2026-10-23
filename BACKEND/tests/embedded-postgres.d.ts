// embedded-postgres ships ESM-only type exports that "moduleResolution: node" cannot see.
declare module 'embedded-postgres' {
  interface Options {
    databaseDir: string;
    user?: string;
    password?: string;
    port?: number;
    persistent?: boolean;
    onLog?: (message: string) => void;
  }
  export default class EmbeddedPostgres {
    constructor(options: Options);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
  }
}
