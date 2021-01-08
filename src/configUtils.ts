import { FieldDefinitionNode } from "graphql";
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

export const AddInternalIDsExtension: GraphQLExtensionDeclaration = (api) => {
  const internalIdField: FieldDefinitionNode = {
    kind: "FieldDefinition",
    description: {
      kind: "StringValue",
      value:
        "Selects the `dataId` for this thing. You can then use __id to interact with the Relay store.",
    },
    name: { kind: "Name", value: "__id" },
    type: {
      kind: "NonNullType",
      type: {
        kind: "NamedType",
        name: {
          kind: "Name",
          value: "ID",
        },
      },
    },
  };

  api.loaders.schema.use((document) => ({
    ...document,
    definitions: document.definitions.map((d) => {
      if (d.kind === "ObjectTypeDefinition") {
        return {
          ...d,
          fields: d.fields ? [internalIdField, ...d.fields] : [internalIdField],
        };
      }

      return d;
    }),
  }));

  return {
    name: "VScodeReScript",
  };
};
