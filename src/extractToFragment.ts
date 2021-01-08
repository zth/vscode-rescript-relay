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

  return { selections, targetSelection, parentTypeName };
};
