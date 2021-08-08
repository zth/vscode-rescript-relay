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
} from "graphql";
import { makeFirstFieldSelection } from "./graphqlUtilsNoVscode";

export type GqlCtx = {
  recordName: string;
  fragmentName: string;
  propName: string;
};

export const findRecordAndModulesFromCompletion = (completionItem: {
  label: string;
  detail: string;
}): null | {
  label: string;
  module: string;
  fragmentName: string;
  recordName: string;
} => {
  const extracted = completionItem.detail.match(
    /(\w+)_graphql(?:.|(?:-\w+".))Types.(\w+)/
  );

  if (extracted != null && extracted.length === 3) {
    return {
      label: completionItem.label,
      module: `${extracted[1]}_graphql`,
      fragmentName: extracted[1],
      recordName: extracted[2],
    };
  }
  return null;
};

export function extractContextFromHover(
  propName: string,
  hoverContents: string
): GqlCtx | null {
  if (hoverContents.includes(" => ")) {
    return null;
  }

  let res;

  let fragmentName: string | null = null;
  let recordName: string | null = null;

  const opFragmentNameExtractorRegexp = /(\w+)_graphql(?:.|(?:-\w+".))Types.(\w+)/g;

  while ((res = opFragmentNameExtractorRegexp.exec(hoverContents)) !== null) {
    fragmentName = res[1] ?? null;
    recordName = res[2] ?? null;

    // A (weird) heuristic for unions
    if (
      hoverContents.startsWith("```rescript\n[") &&
      hoverContents.includes("UnselectedUnionMember(")
    ) {
      const parts = recordName.split("_");
      recordName = parts.slice(0, parts.length - 1).join("_");
    }

    if (fragmentName != null && recordName != null) {
      break;
    }
  }

  if (fragmentName == null || recordName == null) {
    return null;
  }

  return {
    recordName,
    fragmentName,
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
  node: ASTNode
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

  return ["fragment", ...paths, getNameForNode(node)].filter(Boolean).join("_");
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
  schema: GraphQLSchema
): null | GraphQLRecordCtx => {
  const parsed = parse(src);

  let typeOfThisThing: GraphQLNamedType | null = null;
  let astNode:
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
    node: FragmentDefinitionNode | FieldNode | InlineFragmentNode,
    ancestors: any
  ) => {
    const namedPath = getNamedPath(ancestors, node);

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
      checkNode(node, ancestors);
    },
    InlineFragment(node, _a, _b, _c, ancestors) {
      checkNode(node, ancestors);
    },
    FragmentDefinition(node) {
      checkNode(node, []);
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
  fieldName: string
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
    node: FieldNode | FragmentDefinitionNode | InlineFragmentNode,
    ancestors: any
  ): FieldNode | FragmentDefinitionNode | InlineFragmentNode => {
    if (hasAddedField) {
      return node;
    }

    const namedPath = getNamedPath(ancestors, node);

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
  fragmentName: string
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
    node: FieldNode | FragmentDefinitionNode | InlineFragmentNode,
    ancestors: any
  ): FieldNode | FragmentDefinitionNode | InlineFragmentNode => {
    if (hasAddedSpread) {
      return node;
    }

    const namedPath = getNamedPath(ancestors, node);

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
