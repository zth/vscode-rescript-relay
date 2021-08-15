import {
  DocumentNode,
  getLocation,
  getNamedType,
  GraphQLSchema,
  SelectionNode,
  SelectionSetNode,
  Source,
  TypeInfo,
  visit,
  visitWithTypeInfo,
} from "graphql";
import { Position } from "vscode";

interface ExtractToFragmentConfig {
  normalizedSelection: [Position, Position];
  parsedOp: DocumentNode;
  schema: GraphQLSchema;
  source: Source;
}
export const extractToFragment = ({
  normalizedSelection,
  parsedOp,
  schema,
  source,
}: ExtractToFragmentConfig): null | {
  selections: SelectionNode[];
  targetSelection: SelectionSetNode;
  variables: Record<string, string>;
  parentTypeName: string;
} => {
  // Make selection into fragment component
  let parentTypeName: string | undefined;
  let targetSelection: SelectionSetNode | undefined;

  const [st, en] = normalizedSelection;

  const typeInfo = new TypeInfo(schema);

  let variables: Record<string, string> = {};

  const visitor = visitWithTypeInfo(typeInfo, {
    Variable(node) {
      const { loc } = node;

      if (!loc) {
        // @ts-ignore
        variables.__noLoc = true;
        return;
      }

      const start = getLocation(source, loc.start);
      const end = getLocation(source, loc.end);

      if (st.line >= start.line && en.line <= end.line) {
        const arg = typeInfo.getArgument();
        const inputType = typeInfo.getInputType();
        // @ts-ignore
        variables.__extra = {
          arg: arg?.name,
          input: inputType?.toString(),
          hello: true,
        };

        if (arg != null && inputType != null) {
          variables[arg.name] = inputType.toString();
        }
      }
    },
    SelectionSet(node, _key, _parent, _t, _c) {
      const { loc } = node;

      if (!loc) {
        return;
      }

      const start = getLocation(source, loc.start);
      const end = getLocation(source, loc.end);

      if (st.line >= start.line && en.line <= end.line) {
        // @ts-ignore
        variables.__what = true;
        const thisType = typeInfo.getType();

        if (thisType) {
          parentTypeName = getNamedType(thisType).name;
          targetSelection = node;
        }
      }
    },
  });

  visit(parsedOp, visitor);

  const selections: SelectionNode[] = targetSelection
    ? targetSelection.selections.filter((s: SelectionNode) => {
        if (s.loc) {
          const sLocStart = getLocation(source, s.loc.start);
          const sLocEnd = getLocation(source, s.loc.end);

          return sLocStart.line >= st.line && sLocEnd.line <= en.line;
        }

        return false;
      })
    : [];

  if (!targetSelection || !parentTypeName) {
    return null;
  }

  return {
    selections,
    targetSelection,
    parentTypeName,
    variables,
  };
};

export const addFragmentHere = ({
  normalizedSelection,
  parsedOp,
  schema,
  source,
}: ExtractToFragmentConfig): null | {
  addBeforeThisSelection: SelectionNode | null;
  targetSelection: SelectionSetNode;
  parentTypeName: string;
} => {
  // Make selection into fragment component
  let parentTypeName: string | undefined;
  let targetSelection: SelectionSetNode | undefined;

  const [st, en] = normalizedSelection;

  const typeInfo = new TypeInfo(schema);

  const visitor = visitWithTypeInfo(typeInfo, {
    SelectionSet(node, _key, _parent, _t, _c) {
      const { loc } = node;

      if (!loc) {
        return;
      }

      const start = getLocation(source, loc.start);
      const end = getLocation(source, loc.end);

      if (st.line >= start.line && en.line <= end.line) {
        const thisType = typeInfo.getType();

        if (thisType) {
          parentTypeName = getNamedType(thisType).name;
          targetSelection = node;
        }
      }
    },
  });

  visit(parsedOp, visitor);

  const addBeforeThisSelection: SelectionNode | null = targetSelection
    ? targetSelection.selections.find((s: SelectionNode) => {
        if (s.loc) {
          const sLocStart = getLocation(source, s.loc.start);
          const sLocEnd = getLocation(source, s.loc.end);

          return sLocStart.line >= st.line && sLocEnd.line <= en.line;
        }

        return false;
      }) ?? null
    : null;

  if (!targetSelection || !parentTypeName) {
    return null;
  }

  return {
    addBeforeThisSelection,
    targetSelection,
    parentTypeName,
  };
};
