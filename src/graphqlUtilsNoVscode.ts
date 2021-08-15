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
  ObjectFieldNode,
  parse,
  ValueNode,
  VariableDefinitionNode,
  VariableNode,
} from "graphql";
import { State } from "graphql-language-service-parser";

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

export function getStateName(state: State): string | undefined {
  switch (state.kind) {
    case "OperationDefinition":
    case "FragmentDefinition":
    case "AliasedField":
    case "Field":
      return state.name ? state.name : undefined;
  }
}

export function makeArgument(name: string, value: ValueNode): ArgumentNode {
  return {
    kind: "Argument",
    name: {
      kind: "Name",
      value: name,
    },
    value,
  };
}

export function makeArgumentDefinitionVariable(
  name: string,
  type: string,
  defaultValue?: string | undefined
): ArgumentNode {
  const fields: ObjectFieldNode[] = [
    {
      kind: "ObjectField",
      name: {
        kind: "Name",
        value: "type",
      },
      value: {
        kind: "StringValue",
        value: type,
      },
    },
  ];

  if (defaultValue != null) {
    fields.push({
      kind: "ObjectField",
      name: {
        kind: "Name",
        value: "defaultValue",
      },
      value: {
        kind: "IntValue",
        value: defaultValue,
      },
    });
  }

  return {
    kind: "Argument",
    name: {
      kind: "Name",
      value: name,
    },
    value: {
      kind: "ObjectValue",
      fields,
    },
  };
}

export function makeVariableDefinitionNode(
  name: string,
  value: string
): VariableDefinitionNode | undefined {
  const ast = parse(`mutation($${name}: ${value}) { id }`);
  const firstDef = ast.definitions[0];

  if (
    firstDef &&
    firstDef.kind === "OperationDefinition" &&
    firstDef.variableDefinitions
  ) {
    return firstDef.variableDefinitions.find(
      (v) => v.variable.name.value === name
    );
  }
}

export function makeVariableNode(name: string): VariableNode {
  return {
    kind: "Variable",
    name: {
      kind: "Name",
      value: name,
    },
  };
}
