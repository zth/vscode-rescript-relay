import { GraphQLSchema } from "graphql";
import { workspace, window } from "vscode";
import { createGraphQLConfig } from "./graphqlConfig";
import { GraphQLConfig } from "graphql-config";
import * as path from "path";
import { hasHighEnoughReScriptRelayVersion } from "./utils";

interface SchemaCache {
  config: GraphQLConfig;
  schema: GraphQLSchema;
}

interface WorkspaceSchemaCache {
  [id: string]: SchemaCache | undefined;
}

const cache: WorkspaceSchemaCache = {};

export const cacheControl = {
  async refresh(workspaceBaseDir: string) {
    const config = await createGraphQLConfig(workspaceBaseDir);

    if (!config) {
      return false;
    }

    const entry: SchemaCache = {
      config,
      schema: await config.getProject().getSchema(),
    };

    cache[workspaceBaseDir] = entry;

    return true;
  },
  async get(workspaceBaseDir: string) {
    if (!cache[workspaceBaseDir]) {
      await this.refresh(workspaceBaseDir);
    }

    return cache[workspaceBaseDir];
  },
  remove(workspaceBaseDir: string) {
    cache[workspaceBaseDir] = undefined;
  },
};

export function getCurrentWorkspaceRoot(): string | undefined {
  if (workspace.workspaceFolders) {
    return workspace.workspaceFolders[0].uri.fsPath;
  }
}

export function getRelayRoot(): string | undefined {
  const workspaceRoot = getCurrentWorkspaceRoot();
  const pathToRelay = workspace.getConfiguration("rescript-relay").get("pathToRelayProject");

  if (!workspaceRoot || !pathToRelay || typeof pathToRelay !== "string") {
    return;
  }
  else {
    return path.join(workspaceRoot, pathToRelay);
  }
}

let loadSchemaCachePromise: Promise<SchemaCache | undefined> | undefined;

export function getSchemaCacheForWorkspace(
  relayBaseDir: string
): Promise<SchemaCache | undefined> {
  if (loadSchemaCachePromise) {
    return loadSchemaCachePromise;
  }

  loadSchemaCachePromise = new Promise(async (resolve) => {
    const fromCache = cache[relayBaseDir];

    if (fromCache) {
      loadSchemaCachePromise = undefined;
      return resolve(fromCache);
    }

    let schema: GraphQLSchema | undefined;
    let config: GraphQLConfig | undefined;

    config = await createGraphQLConfig(relayBaseDir);

    if (!config) {
      return resolve(undefined);
    }

    try {
      schema = await config.getProject().getSchema();
    } catch (error) {
      console.error("error while getting project schema", error);
      return resolve(undefined);
    }

    if (!config || !schema) {
      loadSchemaCachePromise = undefined;
      return resolve(undefined);
    }

    const entry: SchemaCache = {
      config,
      schema,
    };

    cache[relayBaseDir] = entry;
    loadSchemaCachePromise = undefined;

    return resolve(entry);
  });

  return loadSchemaCachePromise;
}

export async function loadFullSchema(): Promise<GraphQLSchema | undefined> {
  const relayRoot = getRelayRoot();

  if (!relayRoot) {
    return;
  }

  const cacheEntry = await getSchemaCacheForWorkspace(relayRoot);
  return cacheEntry ? cacheEntry.schema : undefined;
}

export async function loadGraphQLConfig(): Promise<GraphQLConfig | undefined> {
  const relayRoot = getRelayRoot();

  if (!relayRoot) {
    return;
  }

  const cacheEntry = await getSchemaCacheForWorkspace(relayRoot);
  return cacheEntry ? cacheEntry.config : undefined;
}

export type RelayConfig = {
  src: string;
  schema: string;
  artifactDirectory: string;
};

export async function loadRelayConfig(): Promise<RelayConfig | undefined> {
  const config = await loadGraphQLConfig();
  if (config) {
    let relayConfig: RelayConfig | undefined;
    try {
      const configFilePath = config.getProject().filepath;
      const rawRelayConfig = require(config.getProject().filepath);

      relayConfig = {
        src: path.resolve(path.dirname(configFilePath), rawRelayConfig.src),
        schema: path.resolve(
          path.dirname(configFilePath),
          rawRelayConfig.schema
        ),
        artifactDirectory: path.resolve(
          path.dirname(configFilePath),
          rawRelayConfig.artifactDirectory
        ),
      };
    } catch (e) {
      console.error("error while loading relay config", e);
      return;
    }

    return relayConfig;
  }
}

export async function isReScriptRelayProject(): Promise<{
  type: "rescript-relay" | "reason-relay";
} | null> {
  const [config, relayConfig] = await Promise.all([
    loadGraphQLConfig(),
    loadRelayConfig(),
  ]);

  if (config && relayConfig) {
    try {
      const configFilePath = config.getProject().filepath;
      const pkgJson = require(path.join(
        path.dirname(configFilePath),
        "package.json"
      ));

      if (pkgJson) {
        const deps = [
          ...Object.keys(pkgJson.dependencies || {}),
          ...Object.keys(pkgJson.peerDependencies || {}),
        ];
        for (const d of deps) {
          if (d === "rescript-relay") {
            return { type: "rescript-relay" };
          }

          if (d === "reason-relay") {
            const version: string = {
              ...pkgJson.dependencies,
              ...pkgJson.peerDependencies,
            }["reason-relay"];

            if (hasHighEnoughReScriptRelayVersion(version)) {
              return { type: "reason-relay" };
            } else {
              window.showWarningMessage(
                "`vscode-rescript-relay` only supports ReasonRelay/ReScriptRelay versions >= 0.13.0."
              );
              return null;
            }
          }
        }
      }
    } catch (error) {
      console.error("error while checking if project is a valid rescript relay project", error);
    }
  }
  window.showErrorMessage("Could not locate relay.config.js, if it's not in the root folder, be sure to configure `settings.rescript-relay.pathToRelayProject`");

  return null;
}
