import {
  Source,
  getLocation,
  GraphQLObjectType,
  GraphQLField,
  ValueNode,
  ArgumentNode,
  SelectionNode,
  SelectionSetNode,
  FieldNode,
  ObjectFieldNode,
  VariableDefinitionNode,
  OperationDefinitionNode,
  DirectiveNode,
  Location,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  parse,
  visit,
  GraphQLInterfaceType,
  print,
  getNamedType,
  GraphQLUnionType,
  VariableNode,
  OperationTypeNode,
  GraphQLScalarType,
  GraphQLEnumType,
} from "graphql";

import { Position } from "vscode";
import { loadFullSchema } from "./loadSchema";
import { prettify } from "./extensionUtils";
import { State } from "graphql-language-service-parser";

export interface NodeWithLoc {
  loc?: Location | undefined;
}

export type NodesWithDirectives =
  | FragmentDefinitionNode
  | FieldNode
  | FragmentSpreadNode
  | OperationDefinitionNode;

export function getStateName(state: State): string | undefined {
  switch (state.kind) {
    case "OperationDefinition":
    case "FragmentDefinition":
    case "AliasedField":
    case "Field":
      return state.name ? state.name : undefined;
  }
}

export function runOnNodeAtPos<T extends NodeWithLoc>(
  source: Source,
  node: T,
  pos: Position,
  fn: (node: T) => T | undefined
) {
  const { loc } = node;

  if (!loc) {
    return;
  }

  const nodeLoc = getLocation(source, loc.start);

  if (nodeLoc.line === pos.line + 1) {
    return fn(node);
  }
}

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
  type: GraphQLObjectType | GraphQLInterfaceType
): FieldNode[] {
  const firstField = getFirstField(type);
  const fieldType = getNamedType(firstField.type);

  const fieldNodes: FieldNode[] = [];

  if (
    fieldType instanceof GraphQLObjectType ||
    fieldType instanceof GraphQLInterfaceType ||
    fieldType instanceof GraphQLUnionType
  ) {
    if (
      fieldType instanceof GraphQLInterfaceType ||
      fieldType instanceof GraphQLUnionType
    ) {
      // Always include __typename for interfaces and unions
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

export function findPath(state: State): string[] {
  const rootName = getStateName(state);

  const path: string[] = rootName ? [rootName] : [];

  let prevState = state.prevState;

  while (prevState) {
    const name = getStateName(prevState);
    if (name) {
      path.push(name);
    }

    prevState = prevState.prevState;
  }

  return path;
}

export function nodeHasDirective(
  node: NodesWithDirectives,
  name: string,
  hasArgs?: (args: readonly ArgumentNode[]) => boolean
): boolean {
  const directive = node.directives
    ? node.directives.find((d) => d.name.value === name)
    : undefined;

  if (!directive) {
    return false;
  }

  if (hasArgs) {
    return directive.arguments ? hasArgs(directive.arguments) : false;
  }

  return true;
}

export function nodeHasVariable(
  node: OperationDefinitionNode,
  name: string
): boolean {
  return node.variableDefinitions
    ? !!node.variableDefinitions.find((v) => v.variable.name.value === name)
    : false;
}

export function addDirectiveToNode<T extends NodesWithDirectives>(
  node: T,
  name: string,
  args: ArgumentNode[]
): T {
  let directives = node.directives || [];

  const existingDirectiveNode: DirectiveNode | undefined = directives.find(
    (d) => d.name.value === name
  );

  let directiveNode: DirectiveNode = existingDirectiveNode || {
    kind: "Directive",
    name: {
      kind: "Name",
      value: name,
    },
    arguments: args,
  };

  if (existingDirectiveNode) {
    directiveNode = {
      ...directiveNode,
      arguments: [...(existingDirectiveNode.arguments || []), ...args].reduce(
        (acc: ArgumentNode[], curr) => {
          const asNewArg = args.find((a) => a.name === curr.name);

          if (!acc.find((a) => a.name === curr.name)) {
            acc.push(asNewArg ? asNewArg : curr);
          }

          return acc;
        },
        []
      ),
    };
  }

  return {
    ...node,
    directives: [
      ...directives.filter((d) => d.name !== directiveNode.name),
      directiveNode,
    ],
  };
}

export async function makeFragment(
  fragmentName: string,
  onTypeName: string,
  selections?: SelectionNode[]
): Promise<string> {
  const schema = await loadFullSchema();

  if (!schema) {
    throw new Error("Could not get schema.");
  }

  const onType = schema.getType(onTypeName);

  if (
    onType &&
    (onType instanceof GraphQLObjectType ||
      onType instanceof GraphQLInterfaceType)
  ) {
    const newFragment = prettify(
      print(
        visit(
          parse(`fragment ${fragmentName} on ${onTypeName} { __typename }`),
          {
            FragmentDefinition(node) {
              const newNode: FragmentDefinitionNode = {
                ...node,
                selectionSet: makeSelectionSet(
                  !selections || selections.length === 0
                    ? [...makeFirstFieldSelection(onType)]
                    : selections
                ),
              };

              return newNode;
            },
          }
        )
      )
    );

    return newFragment;
  }

  throw new Error("Could not build fragment...");
}

interface MakeOperationConfig {
  operationType: OperationTypeNode;
  operationName: string;
  rootField: GraphQLField<
    any,
    any,
    {
      [key: string]: any;
    }
  >;
  onType?: string;
}

export async function makeOperation({
  operationType,
  operationName,
  rootField,
  onType,
}: MakeOperationConfig): Promise<string> {
  return prettify(
    print(
      visit(parse(`${operationType} ${operationName} { __typename }`), {
        OperationDefinition(node) {
          const rootFieldType = getNamedType(rootField.type);

          const requiredArgs = rootField.args.filter((a) =>
            a.type.toString().endsWith("!")
          );

          const firstField =
            rootFieldType instanceof GraphQLObjectType
              ? getFirstField(rootFieldType, operationType)
              : null;

          const newNode: OperationDefinitionNode = {
            ...node,
            variableDefinitions: requiredArgs.reduce(
              (acc: VariableDefinitionNode[], a) => {
                const v = makeVariableDefinitionNode(a.name, a.type.toString());
                if (v) {
                  acc.push(v);
                }

                return acc;
              },
              []
            ),
            selectionSet: makeSelectionSet([
              makeFieldSelection(
                rootField.name,
                rootFieldType instanceof GraphQLUnionType ||
                  rootFieldType instanceof GraphQLInterfaceType
                  ? onType
                    ? [
                        makeFieldSelection("__typename"),
                        {
                          kind: "InlineFragment",
                          typeCondition: {
                            kind: "NamedType",
                            name: { kind: "Name", value: onType },
                          },
                          selectionSet: {
                            kind: "SelectionSet",
                            selections: [makeFieldSelection("id")],
                          },
                        },
                      ]
                    : [makeFieldSelection("__typename")]
                  : rootFieldType instanceof GraphQLScalarType ||
                    rootFieldType instanceof GraphQLEnumType
                  ? []
                  : rootFieldType instanceof GraphQLObjectType
                  ? [
                      firstField && firstField.type instanceof GraphQLObjectType
                        ? makeFieldSelection(
                            firstField.name,
                            makeFirstFieldSelection(
                              firstField.type
                            ).map((f) => ({ kind: "Field", name: f.name }))
                          )
                        : makeFieldSelection(getFirstField(rootFieldType).name),
                    ]
                  : [],
                requiredArgs.map((a) =>
                  makeArgument(a.name, makeVariableNode(a.name))
                )
              ),
            ]),
          };

          return newNode;
        },
      })
    )
  );
}
