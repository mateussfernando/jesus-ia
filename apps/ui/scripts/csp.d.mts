// Tipos de scripts/csp.mjs, para os testes em TypeScript.
export declare const BASE_DIRECTIVES: readonly string[];
export declare function inlineScripts(html: string): string[];
export declare function scriptHash(text: string): string;
export declare function buildPolicy(hashes: readonly string[]): string;
export declare function injectCsp(html: string): string;
export declare function applyCspToDir(dir: string): Promise<number>;
