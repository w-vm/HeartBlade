// Bridge so the UI pages can read live diagnostics from settings.ts without a circular import.
export interface DiagHooks { stats(): any; resetGuard(): void; }
let hooks: DiagHooks = { stats: () => ({}), resetGuard: () => {} };
export const setDiagHooks = (h: DiagHooks) => { hooks = h; };
export const diag = () => hooks;
