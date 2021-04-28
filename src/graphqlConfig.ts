import { ConfigNotFoundError, GraphQLConfig, loadConfig, loadConfigSync } from "graphql-config";
import {
  AddInternalIDsExtension,
  RelayDirectivesExtension,
} from "./configUtils";
import * as path from "path";

const makeLoadConfig = (workspaceBaseDir: string) => ({
  configName: "relay",
  extensions: [
    RelayDirectivesExtension,
    AddInternalIDsExtension,
    () => ({
      name: "customValidationRules",
    }),
  ],
  rootDir: workspaceBaseDir,
});

export async function createGraphQLConfig(
  workspaceBaseDir: string,
  includeValidationRules?: boolean
): Promise<GraphQLConfig | undefined> {
  try {
    const config = await loadConfig(makeLoadConfig(workspaceBaseDir));

    if (!config) {
      return;
    }

    if (includeValidationRules) {
      const project = config.getProject();
      project.extensions["customValidationRules"] = path.resolve(
        path.join(__dirname, "../build/validationRules.js")
      );
    }
    return config;

  } catch (error) {
    if (!(error instanceof ConfigNotFoundError)) {
      console.error("unexpected error while creating GraphQL config");
    };
    return undefined;
  }
}

export function createGraphQLConfigSync(
  workspaceBaseDir: string,
  includeValidationRules?: boolean
): GraphQLConfig | undefined {
  try {
    const config = loadConfigSync(makeLoadConfig(workspaceBaseDir));

    if (!config) {
      return;
    }

    if (includeValidationRules) {
      const project = config.getProject();
      project.extensions["customValidationRules"] = path.resolve(
        path.join(__dirname, "../build/validationRules.js")
      );
    }
    return config;

  } catch (error) {
    if (!(error instanceof ConfigNotFoundError)) {
      console.error("unexpected error while creating GraphQL config");
    };
    return undefined;
  }
}
