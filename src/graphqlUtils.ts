import {
  Source,
  getLocation,
  GraphQLObjectType,
  GraphQLField,
  ArgumentNode,
  SelectionNode,
  FieldNode,
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
  OperationTypeNode,
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLNamedType,
  SourceLocation,
} from "graphql";

import { Position, window } from "vscode";
import * as path from "path";
import { loadFullSchema } from "./loadSchema";
import { prettify } from "./extensionUtils";
import { State } from "graphql-language-service-parser";
import { quickPickFromSchema } from "./addGraphQLComponent";
import { GraphQLSourceFromTag } from "./extensionTypes";
import {
  makeSelectionSet,
  makeFirstFieldSelection,
  makeFieldSelection,
  getFirstField,
  getStateName,
  makeArgument,
  makeVariableDefinitionNode,
  makeVariableNode,
  makeArgumentDefinitionVariable,
} from "./graphqlUtilsNoVscode";

export interface NodeWithLoc {
  loc?: Location | undefined;
}

export type NodesWithDirectives =
  | FragmentDefinitionNode
  | FieldNode
  | FragmentSpreadNode
  | OperationDefinitionNode;

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
  selections?: SelectionNode[],
  variables: Record<string, string> = {}
): Promise<string> {
  const schema = await loadFullSchema();

  if (!schema) {
    throw new Error("Could not get schema.");
  }

  const onType = schema.getType(onTypeName);

  if (
    onType &&
    (onType instanceof GraphQLObjectType ||
      onType instanceof GraphQLInterfaceType ||
      onType instanceof GraphQLUnionType)
  ) {
    const vars = Object.entries(variables);
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
                directives:
                  vars.length > 0
                    ? [
                        {
                          kind: "Directive",
                          name: {
                            kind: "Name",
                            value: "argumentDefinitions",
                          },
                          arguments: vars.map(
                            ([varName, type]): ArgumentNode =>
                              makeArgumentDefinitionVariable(varName, type)
                          ),
                        },
                      ]
                    : [],
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
  skipAddingFieldSelections?: boolean;
  creator?: (node: OperationDefinitionNode) => OperationDefinitionNode;
}

export async function makeOperation({
  operationType,
  operationName,
  rootField,
  onType,
  creator,
}: MakeOperationConfig): Promise<string> {
  return prettify(
    print(
      visit(parse(`${operationType} ${operationName} { __typename }`), {
        OperationDefinition(node) {
          if (creator) {
            return creator(node);
          }

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

export const makeConnectionsVariable = (
  op: OperationDefinitionNode
): VariableDefinitionNode[] => {
  return [
    ...(op.variableDefinitions ?? []),
    {
      kind: "VariableDefinition",
      variable: {
        kind: "Variable",
        name: { kind: "Name", value: "connections" },
      },
      type: {
        kind: "NonNullType",
        type: {
          kind: "ListType",
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "ID" },
            },
          },
        },
      },
    },
  ];
};

export async function pickTypeForFragment(): Promise<string | undefined> {
  const { result } = quickPickFromSchema("Select type of the fragment", (s) =>
    Object.values(s.getTypeMap()).reduce(
      (acc: string[], curr: GraphQLNamedType) => {
        if (
          (curr instanceof GraphQLObjectType ||
            curr instanceof GraphQLInterfaceType ||
            curr instanceof GraphQLUnionType) &&
          !curr.name.startsWith("__")
        ) {
          acc.push(curr.name);
        }

        return acc;
      },
      []
    )
  );

  return await result;
}

type GetFragmentComponentTextConfig = {
  moduleName: string;
  fragmentText: string;
  propName: string;
};

export function getFragmentComponentText({
  moduleName,
  fragmentText,
  propName,
}: GetFragmentComponentTextConfig) {
  return `module ${moduleName} = %relay(\`
${fragmentText
  .split("\n")
  .map((s) => `  ${s}`)
  .join("\n")}
\`)
  
@react.component
let make = (~${propName}) => {
  let ${propName} = ${moduleName}.use(${propName})

  React.null
}`;
}

export function getNewFilePath(newComponentName: string) {
  const editor = window.activeTextEditor;

  if (editor == null) {
    throw new Error("Could not find active editor.");
  }

  const currentFilePath = editor.document.uri.path;
  const thisFileName = path.basename(currentFilePath);

  const newFilePath = editor.document.uri.with({
    path: `${currentFilePath.slice(
      0,
      currentFilePath.length - thisFileName.length
    )}${newComponentName}.res`,
  });

  return newFilePath;
}

const lineCharToPos = ({
  line,
  character,
}: {
  line: number;
  character: number;
}) => new Position(line, character);

export const getStartPosFromTag = (tag: GraphQLSourceFromTag) =>
  lineCharToPos(tag.start);

export const getEnPosFromTag = (tag: GraphQLSourceFromTag) =>
  lineCharToPos(tag.start);

export const getAdjustedPosition = (
  tag: GraphQLSourceFromTag,
  sourceLoc?: SourceLocation | null
) => {
  if (sourceLoc == null) {
    return new Position(tag.start.line, tag.start.character);
  }

  return new Position(sourceLoc.line + tag.start.line, sourceLoc.column);
};
