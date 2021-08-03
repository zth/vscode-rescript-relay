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
} from "graphql";

const opFragmentNameExtractorRegexp = /^`+rescript\n\w+\.(\w+)_graphql\.Types\.(\w+)\n/g;
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

export function extractContextFromHover(hoverContents: string) {
  let res;

  let fragmentName: string | null = null;
  let recordName: string | null = null;

  while ((res = opFragmentNameExtractorRegexp.exec(hoverContents)) !== null) {
    fragmentName = res[1] ?? null;
    recordName = res[2] ?? null;
  }

  if (fragmentName == null || recordName == null) {
    return null;
  }

  return {
    recordName,
    fragmentName,
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

/*const getAncestor = (
  ancestors: ReadonlyArray<ASTNode | ReadonlyArray<ASTNode>> | null
): ASTNode | null => {
  if (ancestors == null) {
    return null;
  }

  let ancestor;
  let i = 0;

  while (ancestor == null) {
    if (i >= ancestors.length) {
      break;
    }

    if (ancestors[i] == null || Array.isArray(ancestors[i])) {
      i += 1;
      continue;
    } else {
      ancestor = ancestors[i];
      break;
    }
  }

  return ancestor as ASTNode | null;
};*/

export const findGraphQLRecordContext = (
  src: string,
  recordName: string,
  schema: GraphQLSchema
): null | {
  type: GraphQLCompositeType;
  startLoc?: SourceLocation | null;
  endLoc?: SourceLocation | null;
} => {
  const parsed = parse(src);

  let typeOfThisThing;
  let startLoc: SourceLocation | null = null;
  let endLoc;

  const typeInfo = new TypeInfo(schema);

  const checkNode = (node: ASTNode, ancestors: any) => {
    const namedPath = getNamedPath(ancestors, node);

    if (namedPath === recordName) {
      const type = typeInfo.getType();
      if (type != null) {
        typeOfThisThing = type;

        //const _ancestor = getAncestor(ancestors);

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

  if (typeOfThisThing == null) {
    return null;
  }

  return {
    type: typeOfThisThing,
    startLoc,
    endLoc,
  };
};
