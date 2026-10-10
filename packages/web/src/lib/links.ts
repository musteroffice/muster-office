/**
 * The two outbound links in the top bar. They are ordinary anchors the viewer clicks, never fetched by the
 * page. Point them at your own accounts when you build:
 *
 *   VITE_GITHUB_URL=https://github.com/you/automicvault VITE_X_URL=https://x.com/you npm run build
 *
 * By default GitHub opens this repository, and the X button opens a pre-filled post about it, so neither needs an account name.
 */
const env = import.meta.env as Record<string, string | undefined>;

export const GITHUB_URL = env["VITE_GITHUB_URL"] || "https://github.com/musteroffice/automicvault";

const SHARE = new URL("https://x.com/intent/post");
SHARE.searchParams.set("text", "Watching my agents work in a pixel-art office: Automicvault, a read-only live dashboard for pi-muster");
SHARE.searchParams.set("url", GITHUB_URL);

export const X_URL = env["VITE_X_URL"] || SHARE.toString();
export const X_LABEL = env["VITE_X_URL"] ? "X" : "Share on X";

