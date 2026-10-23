export interface Repository {
  identity: string;
  path: string;
  name: string;
}
export interface ResolvedRepository {
  identity: string;
  path: string;
  defaultName: string;
}
export interface Project {
  id: string;
  name: string;
  repositories: string[];
}
export interface Catalogue {
  version: 1;
  projects: Project[];
  repositories: Repository[];
}

export const emptyCatalogue = (): Catalogue => ({ version: 1, projects: [], repositories: [] });
const fold = (value: string) => value.toLowerCase();

export function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
}
function name(value: string): string {
  const result = value.trim();
  if (!validName(result)) throw new Error("Name must contain 1–200 characters without control characters.");
  return result;
}

/** Quotes group arguments; backslash escapes a quote or backslash inside quotes. */
export function parseArguments(input: string): string[] {
  const result: string[] = [];
  let token = "", quote = "", started = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = "";
      else if (char === "\\" && (input[i + 1] === quote || input[i + 1] === "\\")) token += input[++i];
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) { result.push(token); token = ""; started = false; }
    } else { token += char; started = true; }
  }
  if (quote) throw new Error("Unclosed quote in command arguments.");
  if (started) result.push(token);
  return result;
}

export function findProject(data: Catalogue, projectName: string): Project {
  const project = data.projects.find(item => fold(item.name) === fold(projectName.trim()));
  if (!project) throw new Error(`Unknown project: ${projectName}. Use /projects create first.`);
  return project;
}
function byId(data: Catalogue, id: string): Project {
  const project = data.projects.find(item => item.id === id);
  if (!project) throw new Error("Project no longer exists. Try again.");
  return project;
}
function uniqueName(data: Catalogue, value: string, except?: string): string {
  const result = name(value);
  if (data.projects.some(item => item.id !== except && fold(item.name) === fold(result))) throw new Error(`Project already exists: ${result}`);
  return result;
}
export function createProject(data: Catalogue, value: string, id: string): Project {
  const project = { id, name: uniqueName(data, value), repositories: [] };
  data.projects.push(project);
  return project;
}
export function renameProject(data: Catalogue, id: string, value: string): void {
  byId(data, id).name = uniqueName(data, value, id);
}
export function deleteProject(data: Catalogue, id: string): void {
  byId(data, id);
  data.projects = data.projects.filter(item => item.id !== id);
}
export function addRepository(data: Catalogue, projectId: string, resolved: ResolvedRepository, displayName?: string): void {
  const project = byId(data, projectId);
  const label = displayName === undefined ? undefined : name(displayName);
  let repository = data.repositories.find(item => item.identity === resolved.identity);
  if (!repository) {
    repository = { identity: resolved.identity, path: resolved.path, name: label ?? name(resolved.defaultName) };
    data.repositories.push(repository);
  } else if (label !== undefined) repository.name = label;
  if (!project.repositories.includes(repository.identity)) project.repositories.push(repository.identity);
}
export function removeRepository(data: Catalogue, projectId: string, identity: string): void {
  const project = byId(data, projectId);
  project.repositories = project.repositories.filter(item => item !== identity);
}
export function nameRepository(data: Catalogue, resolved: ResolvedRepository, displayName?: string): void {
  const repository = data.repositories.find(item => item.identity === resolved.identity);
  if (!repository) throw new Error("Repository is not registered. Use /projects add first.");
  repository.name = name(displayName ?? resolved.defaultName);
}

/** Validate persisted input before it can participate in a mutation. */
export function validateCatalogue(value: unknown): Catalogue {
  const fail = (): never => { throw new Error("Invalid projects catalogue. Fix config.json before retrying; it has not been overwritten."); };
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  const absolute = (item: unknown): item is string => typeof item === "string" && /^(\/|[A-Za-z]:[\\/])/.test(item) && !/[\x00\r\n]/.test(item);
  if (!object(value) || value.version !== 1 || !Array.isArray(value.projects) || !Array.isArray(value.repositories) ||
      Object.keys(value).some(key => !["version", "projects", "repositories"].includes(key))) return fail();
  const identities = new Set<string>(), ids = new Set<string>(), names = new Set<string>();
  for (const repo of value.repositories) {
    if (!object(repo) || !absolute(repo.identity) || !absolute(repo.path) || !validName(repo.name) || identities.has(repo.identity) ||
        Object.keys(repo).some(key => !["identity", "path", "name"].includes(key))) return fail();
    identities.add(repo.identity);
  }
  for (const project of value.projects) {
    if (!object(project) || !validName(project.id) || ids.has(project.id) || !validName(project.name) || names.has(fold(project.name)) ||
        !Array.isArray(project.repositories) || project.repositories.some(item => typeof item !== "string" || !identities.has(item)) ||
        new Set(project.repositories).size !== project.repositories.length || Object.keys(project).some(key => !["id", "name", "repositories"].includes(key))) return fail();
    ids.add(project.id);
    names.add(fold(project.name));
  }
  return value as unknown as Catalogue;
}
