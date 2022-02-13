import { GraphQLConfig, loadConfig, loadConfigSync } from "graphql-config";
import { RelayDirectivesExtension } from "./configUtils";
import * as c from "cosmiconfig";

const configLoader = c.cosmiconfigSync("relay", {
  searchPlaces: [
    "package.json",
    "relay.config.js",
    "relay.json",
    "relay.config.cjs",
  ],
});

const makeLoadConfig = (workspaceBaseDir: string | undefined) => {
  const res = configLoader.search(workspaceBaseDir);

  if (res == null) {
    throw new Error("Did not find config.");
  }

  return {
    filepath: res.filepath,
    configName: "relay",
    extensions: [RelayDirectivesExtension],
    rootDir: workspaceBaseDir,
  };
};

export async function createGraphQLConfig(
  workspaceBaseDir: string | undefined
): Promise<GraphQLConfig | undefined> {
  const config = await loadConfig(makeLoadConfig(workspaceBaseDir));

  if (!config) {
    return;
  }

  return config;
}

export function createGraphQLConfigSync(
  workspaceBaseDir: string | undefined
): GraphQLConfig | undefined {
  const config = loadConfigSync(makeLoadConfig(workspaceBaseDir));

  if (!config) {
    return;
  }

  return config;
}
