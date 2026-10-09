export interface FixtureHome {
  home: string;
  projectDir: string;
  projectFile: string;
  setAgentState(name: string, state: string): void;
  appendDesk(item: { kind: string; title: string; body?: string; resolves?: string }): void;
}
export function makeFixtureHome(home: string, slug?: string): FixtureHome;
export function openFixtureHome(home: string, slug?: string): FixtureHome;
