import { GraphQLConfig, loadConfig } from "graphql-config";
import {
  AddInternalIDsExtension,
  RelayDirectivesExtension,
} from "./configUtils";
import * as path from "path";

export async function createGraphQLConfig(
  workspaceBaseDir: string,
  includeValidationRules?: boolean
): Promise<GraphQLConfig | undefined> {
  const config = await loadConfig({
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
}
