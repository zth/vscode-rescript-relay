import { GraphQLExtensionDeclaration } from "graphql-config";
import { directiveNodes } from "./relayDirectives";

export const RelayDirectivesExtension: GraphQLExtensionDeclaration = (api) => {
  api.loaders.schema.use((document) => ({
    ...document,
    definitions: [...document.definitions, ...directiveNodes],
  }));

  return {
    name: "VScodeReScript",
  };
};
