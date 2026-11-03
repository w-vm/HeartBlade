declare const __HB_VERSION__: string;

interface HBNative {
  version: string;
  dir: string;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): boolean;
  exists(path: string): boolean;
  listDir(path: string): string[];
  removeFile(path: string): boolean;
  log?(line: string): void;
  setInfo?(json: string): void;
  openPanel?(): void;
  setSettingsEntry?(on: boolean): void;
}
declare var __HB_NATIVE__: HBNative | undefined;

declare function setTimeout(fn: (...a: any[]) => void, ms?: number): any;
declare const console: { log(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void };
