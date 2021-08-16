import {
  ASTNode,
  visitWithTypeInfo,
  TypeInfo,
  visit,
  parse,
  GraphQLSchema,
  GraphQLCompositeType,
  getLocation,
  SourceLocation,
  getNamedType,
  FragmentDefinitionNode,
  FieldNode,
  InlineFragmentNode,
  DocumentNode,
  GraphQLObjectType,
  SelectionSetNode,
  SelectionNode,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLNamedType,
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLInputObjectType,
  OperationDefinitionNode,
} from "graphql";
import { makeFirstFieldSelection } from "./graphqlUtilsNoVscode";

export type GraphQLType = "query" | "fragment" | "subscription" | "mutation";

type RescriptRelayValueCtx = {
  type: "RescriptRelayValue";
  value: "dataId";
};

export type GqlCtx = {
  type: "GraphQLValue";
  recordName: string;
  graphqlName: string;
  graphqlType: GraphQLType;
  propName: string;
};

export type ExtractedCtx = GqlCtx | RescriptRelayValueCtx;

export function findGraphQLTypeFromRecord(
  recordName: string,
  graphqlName: string
): GraphQLType {
  let graphqlType: GraphQLType = "fragment";

  if (recordName.startsWith("response")) {
    const graphqlNameLc = graphqlName.toLowerCase();
    if (graphqlNameLc.endsWith("mutation")) {
      graphqlType = "mutation";
    } else if (graphqlNameLc.endsWith("subscription")) {
      graphqlType = "subscription";
    } else if (graphqlNameLc.endsWith("query")) {
      graphqlType = "query";
    }
  } else if (recordName.startsWith("fragment")) {
    graphqlType = "fragment";
  }

  return graphqlType;
}

export const findRecordAndModulesFromCompletion = (completionItem: {
  label: string;
  detail: string;
}): null | {
  label: string;
  module: string;
  graphqlName: string;
  graphqlType: GraphQLType;
  recordName: string;
} => {
  const extracted = completionItem.detail.match(
    /(\w+)_graphql(?:.|(?:-\w+".))Types.(\w+)/
  );

  if (extracted != null && extracted.length === 3) {
    const graphqlName = extracted[1];
    const recordName = extracted[2];
    const graphqlType = findGraphQLTypeFromRecord(recordName, graphqlName);

    return {
      label: completionItem.label,
      module: `${graphqlName}_graphql`,
      graphqlName,
      graphqlType,
      recordName,
    };
  }
  return null;
};

export function extractContextFromHover(
  propName: string,
  hoverContents: string
): ExtractedCtx | null {
  if (
    hoverContents.includes(`\`\`\`rescript
RescriptRelay.dataId`)
  ) {
    return {
      type: "RescriptRelayValue",
      value: "dataId",
    };
  }

  if (hoverContents.includes(" => ")) {
    return null;
  }

  let res;

  let graphqlName: string | null = null;
  let recordName: string | null = null;
  let graphqlType: GraphQLType | null = null;

  const opFragmentNameExtractorRegexp = /(\w+)_graphql(?:.|(?:-\w+".))Types.(\w+)/g;

  while ((res = opFragmentNameExtractorRegexp.exec(hoverContents)) !== null) {
    graphqlName = res[1] ?? null;
    recordName = res[2] ?? null;

    graphqlType = findGraphQLTypeFromRecord(recordName, graphqlName);

    // A (weird) heuristic for unions
    if (
      hoverContents.startsWith("```rescript\n[") &&
      hoverContents.includes("UnselectedUnionMember(")
    ) {
      const parts = recordName.split("_");
      recordName = parts.slice(0, parts.length - 1).join("_");
    }

    if (graphqlName != null && recordName != null) {
      break;
    }
  }

  if (graphqlName == null || recordName == null || graphqlType == null) {
    return null;
  }

  return {
    type: "GraphQLValue",
    recordName,
    graphqlName,
    graphqlType,
    propName,
  };
}

const getNameForNode = (node: ASTNode) => {
  switch (node.kind) {
    case "Field":
      return node.name.value;
    case "InlineFragment":
      return node.typeCondition?.name.value;
  }
};

const getNamedPath = (
  ancestors: ReadonlyArray<ASTNode | ReadonlyArray<ASTNode>> | null,
  node: ASTNode,
  graphqlType: GraphQLType
): string => {
  const paths = (ancestors || []).reduce((acc: string[], next) => {
    if (Array.isArray(next)) {
      return acc;
    }
    const node = next as ASTNode;

    switch (node.kind) {
      case "Field":
        return [...acc, node.name.value];
      case "InlineFragment":
        return [...acc, node.typeCondition?.name.value ?? ""];
      default:
        return acc;
    }
  }, []);

  return [
    graphqlType === "fragment" ? "fragment" : "response",
    ...paths,
    getNameForNode(node),
  ]
    .filter(Boolean)
    .join("_");
};

export interface GraphQLRecordCtx {
  type: GraphQLNamedType;
  description: string | null;
  fieldTypeAsString: string;
  startLoc?: SourceLocation | null;
  endLoc?: SourceLocation | null;
  astNode: FragmentDefinitionNode | FieldNode | InlineFragmentNode | null;
  parsedSource: DocumentNode;
}

export const findGraphQLRecordContext = (
  src: string,
  recordName: string,
  schema: GraphQLSchema,
  graphqlType: GraphQLType
): null | GraphQLRecordCtx => {
  const parsed = parse(src);

  let typeOfThisThing: GraphQLNamedType | null = null;
  let astNode:
    | OperationDefinitionNode
    | FragmentDefinitionNode
    | FieldNode
    | InlineFragmentNode
    | null = null;
  let description: string | null = null;
  let fieldTypeAsString: string | null = null;
  let startLoc: SourceLocation | null = null;
  let endLoc;

  const typeInfo = new TypeInfo(schema);

  const checkNode = (
    node:
      | FragmentDefinitionNode
      | FieldNode
      | InlineFragmentNode
      | OperationDefinitionNode,
    ancestors: any,
    graphqlType: GraphQLType
  ) => {
    const namedPath = getNamedPath(ancestors, node, graphqlType);

    if (namedPath === recordName) {
      const type = typeInfo.getType();
      fieldTypeAsString = type?.toString() ?? null;
      const namedType = type ? getNamedType(type) : null;
      const fieldDef = typeInfo.getFieldDef();

      if (type != null && namedType != null) {
        typeOfThisThing = namedType;
        astNode = node;

        description = fieldDef?.description ?? null;

        // Don't include docs for built in types
        if (
          description == null &&
          !["ID", "String", "Boolean", "Int", "Float"].includes(namedType.name)
        ) {
          description = namedType.description ?? null;
        }

        if (node.loc != null && startLoc == null) {
          startLoc = getLocation(node.loc.source, node.loc.start);
          endLoc = getLocation(node.loc.source, node.loc.end);
        }
      }
    }
  };

  const visitor = visitWithTypeInfo(typeInfo, {
    Field(node, _a, _b, _c, ancestors) {
      checkNode(node, ancestors, graphqlType);
    },
    InlineFragment(node, _a, _b, _c, ancestors) {
      checkNode(node, ancestors, graphqlType);
    },
    FragmentDefinition(node) {
      checkNode(node, [], graphqlType);
    },
    OperationDefinition(node) {
      checkNode(node, [], graphqlType);
    },
  });

  visit(parsed, visitor);

  if (typeOfThisThing == null || fieldTypeAsString == null || astNode == null) {
    return null;
  }

  return {
    astNode,
    type: typeOfThisThing,
    fieldTypeAsString,
    description,
    startLoc,
    endLoc,
    parsedSource: parsed,
  };
};

export function addFieldAtPosition(
  parsedSrc: DocumentNode,
  targetRecordName: string,
  parentType: GraphQLCompositeType,
  fieldName: string,
  graphqlType: GraphQLType
) {
  if (parentType instanceof GraphQLObjectType === false) {
    return parsedSrc;
  }

  const type = parentType as GraphQLObjectType;
  const field = Object.values(type.getFields()).find(
    (field) => field.name === fieldName
  );

  if (field == null) {
    return parsedSrc;
  }

  const namedFieldType = getNamedType(field.type);

  let hasAddedField = false;

  const resolveNode = (
    node:
      | FieldNode
      | FragmentDefinitionNode
      | InlineFragmentNode
      | OperationDefinitionNode,
    ancestors: any
  ):
    | FieldNode
    | FragmentDefinitionNode
    | InlineFragmentNode
    | OperationDefinitionNode => {
    if (hasAddedField) {
      return node;
    }

    const namedPath = getNamedPath(ancestors, node, graphqlType);

    if (namedPath === targetRecordName) {
      const selections: SelectionNode[] = [];

      if (
        namedFieldType instanceof GraphQLObjectType ||
        namedFieldType instanceof GraphQLInterfaceType ||
        namedFieldType instanceof GraphQLUnionType
      ) {
        selections.push(...makeFirstFieldSelection(namedFieldType));
      }

      hasAddedField = true;

      const newFieldNode: SelectionNode = {
        kind: "Field",
        name: {
          kind: "Name",
          value: field.name,
        },
        selectionSet: {
          kind: "SelectionSet",
          selections,
        },
      };

      const newSelectionSet: SelectionSetNode = {
        kind: "SelectionSet",
        ...node.selectionSet,
        selections: [...(node.selectionSet?.selections ?? []), newFieldNode],
      };

      return {
        ...node,
        selectionSet: newSelectionSet,
      };
    }

    return node;
  };

  const newSrc = visit(parsedSrc, {
    OperationDefinition(node, _a, _b, _c, ancestors) {
      return resolveNode(node, ancestors);
    },
    FragmentDefinition(node, _a, _b, _c, ancestors) {
      return resolveNode(node, ancestors);
    },
    InlineFragment(node, _a, _b, _c, ancestors) {
      return resolveNode(node, ancestors);
    },
    Field(node, _a, _b, _c, ancestors) {
      return resolveNode(node, ancestors);
    },
  });

  return newSrc;
}

export function addFragmentSpreadAtPosition(
  parsedSrc: DocumentNode,
  targetRecordName: string,
  parentType: GraphQLCompositeType,
  fragmentName: string,
  graphqlType: GraphQLType
) {
  if (
    parentType instanceof GraphQLObjectType === false &&
    parentType instanceof GraphQLInterfaceType === false &&
    parentType instanceof GraphQLUnionType === false
  ) {
    return null;
  }

  let hasAddedSpread = false;

  const resolveNode = (
    node:
      | FieldNode
      | FragmentDefinitionNode
      | InlineFragmentNode
      | OperationDefinitionNode,
    ancestors: any
  ):
    | FieldNode
    | FragmentDefinitionNode
    | InlineFragmentNode
    | OperationDefinitionNode => {
    if (hasAddedSpread) {
      return node;
    }

    const namedPath = getNamedPath(ancestors, node, graphqlType);

    if (namedPath === targetRecordName) {
      hasAddedSpread = true;

      const newFieldNode: SelectionNode = {
        kind: "FragmentSpread",
        name: {
          kind: "Name",
          value: fragmentName,
        },
      };

      const newSelectionSet: SelectionSetNode = {
        kind: "SelectionSet",
        ...node.selectionSet,
        selections: [...(node.selectionSet?.selections ?? []), newFieldNode],
      };

      return {
        ...node,
        selectionSet: newSelectionSet,
      };
    }

    return node;
  };

  const newSrc = visit(parsedSrc, {
    OperationDefinition(node, _a, _b, _c, ancestors) {
      return resolveNode(node, ancestors);
    },
    FragmentDefinition(node, _a, _b, _c, ancestors) {
      return resolveNode(node, ancestors);
    },
    InlineFragment(node, _a, _b, _c, ancestors) {
      return resolveNode(node, ancestors);
    },
    Field(node, _a, _b, _c, ancestors) {
      return resolveNode(node, ancestors);
    },
  });

  return hasAddedSpread ? newSrc : null;
}

export function namedTypeToString(type: GraphQLNamedType): string {
  if (type instanceof GraphQLObjectType) {
    return "object";
  } else if (type instanceof GraphQLUnionType) {
    return "union";
  } else if (type instanceof GraphQLInterfaceType) {
    return "interface";
  } else if (type instanceof GraphQLScalarType) {
    return "scalar";
  } else if (type instanceof GraphQLEnumType) {
    return "enum";
  } else if (type instanceof GraphQLInputObjectType) {
    return "input object";
  }

  return "-";
}
