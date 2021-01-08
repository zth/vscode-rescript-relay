import { GraphQLConfig, loadConfigSync } from "graphql-config";
import {
  AddInternalIDsExtension,
  RelayDirectivesExtension,
} from "./configUtils";
import * as path from "path";

export function createGraphQLConfig(
  workspaceBaseDir: string,
  includeValidationRules?: boolean
): GraphQLConfig | undefined {
  const config = loadConfigSync({
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

  if (includeValidationRules) {
    const project = config.getProject();
    project.extensions["customValidationRules"] = path.resolve(
      path.join(__dirname, "../build/validationRules.js")
    );
  }

  return config;
}
