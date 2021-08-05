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
} from "graphql";
import {
  makeFieldSelection,
  makeFirstFieldSelection,
} from "./graphqlUtilsNoVscode";

// const fragmentRefsExtractor = /\.fragmentRefs<[\s\S.]+\[([#A-Za-z_ \s\S|]+)\]/g;

/*function extractFragmentRefs(src: string) {
  let res;
  let fragmentRefs;

  while ((res = opFragmentNameExtractorRegexp.exec(src)) !== null) {
    fragmentRefs = res[1] ?? null;
  }

  if (fragmentRefs == null) {
    return null;
  }

  return fragmentRefs.split(` | `);
}*/

export type GqlCtx = {
  recordName: string;
  fragmentName: string;
  propName: string;
};

export function extractContextFromHover(
  propName: string,
  hoverContents: string
): GqlCtx | null {
  let res;

  let fragmentName: string | null = null;
  let recordName: string | null = null;

  const opFragmentNameExtractorRegexp = /\w+\.(\w+)_graphql.Types\.(\w+).*/g;

  while ((res = opFragmentNameExtractorRegexp.exec(hoverContents)) !== null) {
    fragmentName = res[1] ?? null;
    recordName = res[2] ?? null;

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

export const findGraphQLRecordContext = (
  src: string,
  recordName: string,
  schema: GraphQLSchema
): null | {
  type: GraphQLCompositeType;
  description: string | null;
  fieldTypeAsString: string;
  startLoc?: SourceLocation | null;
  endLoc?: SourceLocation | null;
  astNode: FragmentDefinitionNode | FieldNode | InlineFragmentNode | null;
  parsedSource: DocumentNode;
} => {
  const parsed = parse(src);

  let typeOfThisThing;
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

        description = fieldDef.description ?? null;

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
