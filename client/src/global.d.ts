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
  // Added in 0.2.0 (older .deb builds do not have these; the UI checks before using them)
  getPrefs?(): string;
  setPref?(name: string, value: string): boolean;
  getLogs?(): string;
  debugReport?(): string;
  copy?(text: string): void;
  restart?(): void;
}
declare var __HB_NATIVE__: HBNative | undefined;

declare function setTimeout(fn: (...a: any[]) => void, ms?: number): any;
declare const console: { log(...a: any[]): void; warn(...a: any[]): void; error(...a: any[]): void };
declare function setInterval(fn: (...a: any[]) => void, ms?: number): any;
declare function clearInterval(id: any): void;
declare function fetch(url: string, init?: any): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
