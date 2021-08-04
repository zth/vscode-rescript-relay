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
} from "graphql";

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
} => {
  const parsed = parse(src);

  let typeOfThisThing;
  let description: string | null = null;
  let fieldTypeAsString: string | null = null;
  let startLoc: SourceLocation | null = null;
  let endLoc;

  const typeInfo = new TypeInfo(schema);

  const checkNode = (node: ASTNode, ancestors: any) => {
    const namedPath = getNamedPath(ancestors, node);

    if (namedPath === recordName) {
      const type = typeInfo.getType();
      fieldTypeAsString = type?.toString() ?? null;
      const namedType = type ? getNamedType(type) : null;
      const fieldDef = typeInfo.getFieldDef();

      if (type != null && namedType != null) {
        typeOfThisThing = namedType;

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

  if (typeOfThisThing == null || fieldTypeAsString == null) {
    return null;
  }

  return {
    type: typeOfThisThing,
    fieldTypeAsString,
    description,
    startLoc,
    endLoc,
  };
};
