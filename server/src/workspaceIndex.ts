import { Location, WorkspaceFolder } from 'vscode-languageserver/node';
import { promises as fsPromises } from 'fs';
import { join, extname } from 'path';
import Uri from 'vscode-uri';
import { RakuElem, RakuSymbolKind, ParseType, NavigatorSettings } from './types';
import { parseFromUri } from './parser';
import { nLog } from './utils';

// Hard limits to protect against very large workspaces
const MAX_INDEX_FILES = 5000;     // max files to index in initial build
const MAX_INDEX_SYMBOLS = 100000; // max symbols to index in initial build

// Maintains a workspace-wide index of tokens and rules for navigation
export class WorkspaceIndex {
    // symbol name -> list of elements across workspace
    private symbolsByName: Map<string, RakuElem[]> = new Map();
    // file uri -> list of names defined in that file (for fast invalidation)
    private fileToNames: Map<string, string[]> = new Map();

    async build(workspaceFolders: WorkspaceFolder[] | null | undefined, settings?: NavigatorSettings): Promise<void> {
        if (!workspaceFolders || workspaceFolders.length === 0) return;
        const uris = new Set<string>();
        let filesBudget = MAX_INDEX_FILES;
        for (const folder of workspaceFolders) {
            const rootPath = Uri.parse(folder.uri).fsPath;
            if (filesBudget <= 0) break;
            const files = await this.walkRakuFiles(rootPath, filesBudget);
            for (const f of files) {
                uris.add(Uri.file(f).toString());
            }
            filesBudget = MAX_INDEX_FILES - uris.size;
            if (filesBudget <= 0) break;
        }
        nLog(`WorkspaceIndex: building for ${uris.size} files`, settings || { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
        // Index sequentially to limit CPU/memory spikes
        let totalAdded = 0;
        for (const uri of uris) {
            if (totalAdded >= MAX_INDEX_SYMBOLS) {
                nLog(`WorkspaceIndex: symbol limit (${MAX_INDEX_SYMBOLS}) reached; stopping build early`, settings || { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
                break;
            }
            totalAdded += await this.reindexFile(uri, settings);
        }
        nLog(`WorkspaceIndex: build complete. Total symbols indexed: ${totalAdded}`, settings || { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
    }

    async reindexFile(uri: string, settings?: NavigatorSettings): Promise<number> {
        // remove old entries first to avoid duplicates
        this.removeFile(uri, settings);
        const rdoc = await parseFromUri(uri, ParseType.workspaceIndex);
        if (!rdoc) {
            nLog(`WorkspaceIndex: parseFromUri returned no document for ${uri}`, settings || { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
            return 0;
        }

    const namesForFileSet = new Set<string>();
    let added = 0;
        // Which symbol kinds to include in the index
        const includeKinds = new Set<RakuSymbolKind>([
            RakuSymbolKind.Token,
            RakuSymbolKind.Rule,
            RakuSymbolKind.Class,
            RakuSymbolKind.Role,
            RakuSymbolKind.Grammar,
            RakuSymbolKind.LocalSub,
            RakuSymbolKind.LocalMethod,
            RakuSymbolKind.LocalModule,
            RakuSymbolKind.Package,
        ]);

        const aliasKinds = new Set<RakuSymbolKind>([
            RakuSymbolKind.LocalSub,
            RakuSymbolKind.LocalMethod,
        ]);

        const addToIndex = (key: string, elem: RakuElem) => {
            let list = this.symbolsByName.get(key);
            if (!list) list = [];
            list.push(elem);
            this.symbolsByName.set(key, list);
            namesForFileSet.add(key);
            added += 1;
        };

        rdoc.elems.forEach((arr, name) => {
            if (!arr || arr.length === 0) return;
            const filtered = arr.filter(e => includeKinds.has(e.type as RakuSymbolKind));
            if (filtered.length === 0) return;

            for (const e of filtered) {
                // Always index by the bare name
                addToIndex(name, e);
                // For functions (subs/methods), also index as package::name if available
                if (aliasKinds.has(e.type as RakuSymbolKind)) {
                    const pkg = (e.package || '').trim();
                    if (pkg && !name.includes('::')) {
                        addToIndex(`${pkg}::${name}`, e);
                    }
                }
            }
        });
        if (namesForFileSet.size) this.fileToNames.set(uri, Array.from(namesForFileSet));
        nLog(`WorkspaceIndex: reindexed ${uri} — ${added} symbols`, settings || { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
        return added;
    }

    removeFile(uri: string, settings?: NavigatorSettings): void {
        const names = this.fileToNames.get(uri);
        if (!names) return;
        let removed = 0;
        for (const name of names) {
            const list = this.symbolsByName.get(name);
            if (!list) continue;
            const filtered = list.filter(e => e.uri !== uri);
            if (filtered.length === 0) {
                this.symbolsByName.delete(name);
            } else {
                this.symbolsByName.set(name, filtered);
            }
            removed++;
        }
        this.fileToNames.delete(uri);
        nLog(`WorkspaceIndex: removed ${uri} — cleared ${removed} names`, settings || { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
    }

    findByName(name: string): RakuElem[] {
        return this.symbolsByName.get(name) || [];
    }

    getLocations(name: string): Location[] {
        const elems = this.findByName(name);
        return elems.map(e => ({
            uri: e.uri,
            range: {
                start: { line: e.line, character: 0 },
                end: { line: e.line, character: 500 }
            }
        }));
    }

    private async walkRakuFiles(root: string, max?: number): Promise<string[]> {
        const out: string[] = [];
        const ignore = new Set<string>([".git", ".svn", ".hg", "node_modules", ".idea", ".vscode", "target", "build", "dist"]);
        // Track visited directories and files by their real paths to avoid cycles and duplicates
        const visitedDirs = new Set<string>();
        const seenRealFiles = new Set<string>();

        // Normalize the root to a real path when possible
        let startDir = root;
        try { startDir = await fsPromises.realpath(root); } catch { /* keep as-is */ }

        const stack: string[] = [startDir];
        visitedDirs.add(startDir);

        while (stack.length) {
            const dir = stack.pop()!;
            let entries: string[];
            try {
                entries = await fsPromises.readdir(dir);
            } catch {
                continue;
            }
            for (const name of entries) {
                const full = join(dir, name);
                let lst;
                try {
                    lst = await fsPromises.lstat(full);
                } catch {
                    continue;
                }

                if (lst.isSymbolicLink()) {
                    // Follow symlinks carefully and guard against cycles
                    try {
                        const targetStat = await fsPromises.stat(full);
                        if (targetStat.isDirectory()) {
                            // Resolve real path and avoid revisiting
                            let real: string;
                            try { real = await fsPromises.realpath(full); } catch { continue; }
                            if (ignore.has(name)) continue;
                            if (visitedDirs.has(real)) continue;
                            visitedDirs.add(real);
                            stack.push(real);
                        } else if (targetStat.isFile()) {
                            if (!this.isRakuFile(full)) continue;
                            let realFile: string | null = null;
                            try { realFile = await fsPromises.realpath(full); } catch { /* ignore */ }
                            if (realFile && seenRealFiles.has(realFile)) continue;
                            if (realFile) seenRealFiles.add(realFile);
                            out.push(full);
                            if (max && out.length >= max) return out;
                        }
                    } catch (err: any) {
                        // ELOOP or other errors while following symlink: skip
                        continue;
                    }
                    continue;
                }

                if (lst.isDirectory()) {
                    if (ignore.has(name)) continue;
                    let real: string = full;
                    try { real = await fsPromises.realpath(full); } catch { /* keep as-is */ }
                    if (visitedDirs.has(real)) continue;
                    visitedDirs.add(real);
                    stack.push(real);
                } else if (lst.isFile()) {
                    if (!this.isRakuFile(full)) continue;
                    let realFile: string | null = null;
                    try { realFile = await fsPromises.realpath(full); } catch { /* ignore */ }
                    if (realFile && seenRealFiles.has(realFile)) continue;
                    if (realFile) seenRealFiles.add(realFile);
                    out.push(full);
                    if (max && out.length >= max) return out;
                }
            }
        }
        return out;
    }

    private isRakuFile(filePath: string): boolean {
        const ext = extname(filePath).toLowerCase();
        // Common Raku file extensions
        return [
            '.raku',
            '.rakumod',
            '.rakutest',
            '.rakudoc',
            '.pm6',
            '.p6',
            '.t6',
        ].includes(ext);
    }
}
// Expose a shared instance used across the server
export const workspaceIndex = new WorkspaceIndex();

// Provide a clear/reset API
export function resetWorkspaceIndex() {
    // Helper for clearing state on workspace folder changes
    (workspaceIndex as any).symbolsByName = new Map();
    (workspaceIndex as any).fileToNames = new Map();
}
