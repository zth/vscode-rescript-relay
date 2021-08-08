import {
  SelectionNode,
  SelectionSetNode,
  ArgumentNode,
  FieldNode,
  GraphQLObjectType,
  GraphQLInterfaceType,
  GraphQLUnionType,
  getNamedType,
  GraphQLField,
  OperationTypeNode,
} from "graphql";

export function getFirstField(
  obj: GraphQLObjectType | GraphQLInterfaceType,
  type?: OperationTypeNode
): GraphQLField<any, any, { [key: string]: any }> {
  const fields = Object.values(obj.getFields());

  if (type === "mutation") {
    const firstRealField = fields.find(
      (v) => v.type instanceof GraphQLObjectType
    );

    if (firstRealField) {
      return firstRealField;
    }
  }

  const hasIdField = fields.find((v) => v.name === "id");
  const firstField = hasIdField ? hasIdField : fields[0];

  return firstField;
}

export function makeSelectionSet(
  selections: SelectionNode[]
): SelectionSetNode {
  return {
    kind: "SelectionSet",
    selections,
  };
}

export function makeFieldSelection(
  name: string,
  selections?: SelectionNode[],
  args?: ArgumentNode[]
): FieldNode {
  return {
    kind: "Field",
    name: {
      kind: "Name",
      value: name,
    },
    selectionSet: selections != null ? makeSelectionSet(selections) : undefined,
    arguments: args,
  };
}

export function makeFirstFieldSelection(
  type: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType
): FieldNode[] {
  if (type instanceof GraphQLUnionType) {
    return [makeFieldSelection("__typename")];
  }

  const firstField = getFirstField(type);
  const fieldType = getNamedType(firstField.type);

  const fieldNodes: FieldNode[] = [];

  if (
    fieldType instanceof GraphQLObjectType ||
    fieldType instanceof GraphQLInterfaceType
  ) {
    if (fieldType instanceof GraphQLInterfaceType) {
      // Always include __typename for interfaces
      fieldNodes.push(makeFieldSelection("__typename"));
    }

    // Include sub selections automatically
    fieldNodes.push(
      makeFieldSelection(firstField.name, [makeFieldSelection("__typename")])
    );

    return fieldNodes;
  }

  return [makeFieldSelection(firstField.name)];
}
