import { open, realpath, readdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

/**
 * The only module that touches the filesystem. It is read-only by construction:
 *
 *  - every path must resolve (after following symlinks) to a location inside a registered root;
 *  - files are opened with the "r" flag only, and must be regular files;
 *  - nothing here can create, modify, rename or delete anything.
 *
 * Roots come from the Muster registry (project directories) and the fixed Muster state
 * directories under `home`. A path in a catalog (e.g. a packet's `report`) is untrusted
 * data: it is honoured only when it lands inside a root.
 */

export class PathDenied extends Error {
  override readonly name = "PathDenied";
}
export class TooLarge extends Error {
  override readonly name = "TooLarge";
}

const isWin = process.platform === "win32";
const fold = (p: string): string => (isWin ? p.toLowerCase() : p);

interface Root {
  /** Absolute path as registered (not yet symlink-resolved). */
  path: string;
  kind: "dir" | "file";
}

function isErr(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && (e as NodeJS.ErrnoException).code === code;
}

export class SafeReader {
  private roots: Root[] = [];
  private realCache = new Map<string, { real: string; at: number }>();

  /** Replace all roots. Paths that are not absolute or contain NUL are ignored. */
  setRoots(roots: Root[]): void {
    this.roots = roots.filter((r) => isAbsolute(r.path) && !r.path.includes("\0")).map((r) => ({ ...r, path: resolve(r.path) }));
    this.realCache.clear();
  }

  addRoot(path: string, kind: Root["kind"]): void {
    if (!isAbsolute(path) || path.includes("\0")) return;
    const p = resolve(path);
    if (!this.roots.some((r) => r.path === p && r.kind === kind)) this.roots.push({ path: p, kind });
  }

  getRoots(): readonly Root[] {
    return this.roots;
  }

  private async realRoot(root: Root): Promise<string> {
    const hit = this.realCache.get(root.path);
    if (hit && Date.now() - hit.at < 5_000) return hit.real;
    let real: string;
    try {
      real = await realpath(root.path);
    } catch {
      real = root.path; // not created yet: fall back to the lexical path
    }
    this.realCache.set(root.path, { real, at: Date.now() });
    return real;
  }

  /** Resolve symlinks and verify containment. Returns the real path, or throws PathDenied. */
  async resolveReal(path: string): Promise<string> {
    if (typeof path !== "string" || path.includes("\0") || !isAbsolute(path)) throw new PathDenied("path must be absolute");
    let real: string;
    try {
      real = await realpath(path);
    } catch (e) {
      if (isErr(e, "ENOENT") || isErr(e, "ENOTDIR")) {
        // Missing is only reported for paths that would be inside a root. Otherwise a catalog
        // author could probe which files exist elsewhere by telling "missing" from "denied".
        if (!(await this.lexicallyInside(path))) throw new PathDenied("path is outside every allowed root");
        throw e;
      }
      throw new PathDenied(`cannot resolve path: ${(e as Error).message}`);
    }
    const f = fold(real);
    for (const root of this.roots) {
      const rr = fold(await this.realRoot(root));
      if (root.kind === "file" ? f === rr : f === rr || f.startsWith(rr.endsWith(sep) ? rr : rr + sep)) return real;
    }
    throw new PathDenied("path is outside every allowed root");
  }

  private async lexicallyInside(path: string): Promise<boolean> {
    const f = fold(resolve(path));
    for (const root of this.roots) {
      for (const base of [root.path, await this.realRoot(root)]) {
        const b = fold(base);
        if (root.kind === "file" ? f === b : f === b || f.startsWith(b.endsWith(sep) ? b : b + sep)) return true;
      }
    }
    return false;
  }

  /** Read a whole text file. Returns null when the file does not exist. */
  async readText(path: string, maxBytes = 16 * 1024 * 1024): Promise<string | null> {
    const h = await this.openRead(path);
    if (!h) return null;
    try {
      const st = await h.stat();
      if (!st.isFile()) throw new PathDenied("not a regular file");
      if (st.size > maxBytes) throw new TooLarge(`file is ${st.size} bytes (limit ${maxBytes})`);
      return await h.readFile({ encoding: "utf8" });
    } finally {
      await h.close();
    }
  }

  /** Open read-only after containment checks. Returns null when missing. */
  async openRead(path: string): Promise<FileHandle | null> {
    let real: string;
    try {
      real = await this.resolveReal(path);
    } catch (e) {
      if (isErr(e, "ENOENT") || isErr(e, "ENOTDIR")) return null;
      throw e;
    }
    try {
      return await open(real, "r");
    } catch (e) {
      if (isErr(e, "ENOENT")) return null;
      throw e;
    }
  }

  /** File names inside a directory root (or a directory under one). Empty when missing. */
  async list(dir: string): Promise<string[]> {
    let real: string;
    try {
      real = await this.resolveReal(dir);
    } catch (e) {
      if (isErr(e, "ENOENT") || isErr(e, "ENOTDIR")) return [];
      throw e;
    }
    try {
      return await readdir(real);
    } catch (e) {
      if (isErr(e, "ENOENT") || isErr(e, "ENOTDIR")) return [];
      throw e;
    }
  }

  async statFile(path: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const real = await this.resolveReal(path);
      const st = await stat(real);
      return st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
    } catch (e) {
      if (isErr(e, "ENOENT") || isErr(e, "ENOTDIR")) return null;
      throw e;
    }
  }
}
