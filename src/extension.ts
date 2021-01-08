import * as path from "path";
import * as fs from "fs";
import { pascalCase } from "pascal-case";
import * as cp from "child_process";

import {
  workspace,
  ExtensionContext,
  window,
  OutputChannel,
  commands,
  TextEditorEdit,
  Range,
  Position,
  languages,
  CodeAction,
  Uri,
  CodeActionKind,
  WorkspaceEdit,
  TextEditor,
  ProgressLocation,
  Selection,
  StatusBarAlignment,
  Diagnostic,
} from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  Command,
  RevealOutputChannelOn,
  Disposable,
  HandleDiagnosticsSignature,
} from "vscode-languageclient";

import {
  prettify,
  restoreOperationPadding,
  uncapitalize,
  capitalize,
  wrapInJsx,
  getNormalizedSelection,
} from "./extensionUtils";
import {
  extractGraphQLSources,
  getSelectedGraphQLOperation,
} from "./findGraphQLSources";
import {
  getTokenAtPosition,
  getTypeInfo,
} from "graphql-language-service-interface/dist/getAutocompleteSuggestions";
import { Position as GraphQLPosition } from "graphql-language-service-utils";

import { GraphQLSource, GraphQLSourceFromTag } from "./extensionTypes";

import { addGraphQLComponent } from "./addGraphQLComponent";
import {
  parse,
  GraphQLObjectType,
  print,
  visit,
  Source,
  FragmentSpreadNode,
  SelectionNode,
  getNamedType,
  ASTNode,
  FieldNode,
  GraphQLUnionType,
  SelectionSetNode,
  InlineFragmentNode,
  GraphQLInterfaceType,
} from "graphql";
import {
  loadFullSchema,
  getCurrentWorkspaceRoot,
  cacheControl,
  loadRelayConfig,
  loadGraphQLConfig,
  isReScriptRelayProject,
} from "./loadSchema";
import {
  nodeHasVariable,
  makeVariableDefinitionNode,
  runOnNodeAtPos,
  nodeHasDirective,
  addDirectiveToNode,
  makeArgumentDefinitionVariable,
  findPath,
  makeArgument,
  makeSelectionSet,
  makeFieldSelection,
  getFirstField,
  makeFragment,
} from "./graphqlUtils";
import { extractToFragment } from "./extractToFragment";

function getModuleNameFromFile(uri: Uri): string {
  return capitalize(path.basename(uri.path, ".res"));
}

function makeReplaceOperationEdit(
  uri: Uri,
  op: GraphQLSourceFromTag,
  newOp: ASTNode
): WorkspaceEdit {
  const edit = new WorkspaceEdit();
  edit.replace(
    uri,
    new Range(
      new Position(op.start.line, op.start.character),
      new Position(op.end.line, op.end.character)
    ),
    restoreOperationPadding(prettify(print(newOp)), op.content)
  );

  return edit;
}

function formatDocument(textEditor: TextEditor | undefined) {
  if (!textEditor) {
    window.showErrorMessage("Missing active text editor.");
    return;
  }

  const sources = extractGraphQLSources(
    textEditor.document.languageId,
    textEditor.document.getText()
  );

  textEditor.edit((editBuilder: TextEditorEdit) => {
    const textDocument = textEditor.document;

    if (!textDocument) {
      return;
    }

    if (sources) {
      sources.forEach((source: GraphQLSource) => {
        if (source.type === "TAG" && /^[\s]+$/g.test(source.content)) {
          window.showInformationMessage("Cannot format an empty code block.");
          return;
        }
        try {
          const newContent = restoreOperationPadding(
            prettify(source.content),
            source.content
          );

          if (source.type === "TAG") {
            editBuilder.replace(
              new Range(
                new Position(source.start.line, source.start.character),
                new Position(source.end.line, source.end.character)
              ),
              newContent
            );
          } else if (source.type === "FULL_DOCUMENT" && textDocument) {
            editBuilder.replace(
              new Range(
                new Position(0, 0),
                new Position(textDocument.lineCount + 1, 0)
              ),
              newContent
            );
          }
        } catch {
          // Silent
        }
      });
    }
  });
}

type GraphQLTypeAtPos = {
  parentTypeName: string;
};

function initHoverProviders() {
  languages.registerCodeActionsProvider("rescript", {
    async provideCodeActions(
      document,
      selection
    ): Promise<(CodeAction | Command)[] | undefined> {
      if (selection instanceof Range === false) {
        return;
      }

      const selectedOp = getSelectedGraphQLOperation(
        document.getText(),
        selection.start
      );

      if (!selectedOp) {
        return;
      }

      const startPos = new Position(
        selection.start.line - selectedOp.start.line,
        selection.start.character
      );

      const token = getTokenAtPosition(
        selectedOp.content,
        new GraphQLPosition(
          selection.start.line - selectedOp.start.line,
          selection.start.character
        )
      );

      const parsedOp = parse(selectedOp.content);
      const firstDef = parsedOp.definitions[0];
      const source = new Source(selectedOp.content);

      const state =
        token.state.kind === "Invalid" ? token.state.prevState : token.state;

      if (!state) {
        return [];
      }

      const schema = await loadFullSchema();

      if (!schema) {
        return [];
      }

      const typeInfo = getTypeInfo(schema, state);
      const t = typeInfo.type ? getNamedType(typeInfo.type) : undefined;
      const parentT = typeInfo.parentType
        ? getNamedType(typeInfo.parentType)
        : undefined;

      const actions: (CodeAction | Command)[] = [];

      if (firstDef && firstDef.kind === "OperationDefinition") {
        if (state.kind === "Variable" && state.prevState) {
          const inputType = typeInfo.inputType
            ? typeInfo.inputType.toString()
            : undefined;
          const variableName = state.name;

          if (
            inputType &&
            variableName &&
            !nodeHasVariable(firstDef, variableName)
          ) {
            const variableDefinitionNode = makeVariableDefinitionNode(
              variableName,
              inputType
            );

            const addToOperationVariables = new CodeAction(
              `Add "$${name}" to operation variables`,
              CodeActionKind.RefactorRewrite
            );

            addToOperationVariables.edit = makeReplaceOperationEdit(
              document.uri,
              selectedOp,
              visit(parsedOp, {
                OperationDefinition(node) {
                  return {
                    ...node,
                    variableDefinitions: node.variableDefinitions
                      ? [...node.variableDefinitions, variableDefinitionNode]
                      : [variableDefinitionNode],
                  };
                },
              })
            );

            actions.push(addToOperationVariables);
          }
        }
      }

      if (parentT && parentT instanceof GraphQLObjectType) {
        const extractedFragment = extractToFragment({
          parsedOp,
          schema,
          normalizedSelection: getNormalizedSelection(selection, selectedOp),
          source,
        });

        if (extractedFragment && extractedFragment.selections.length > 0) {
          const extractFragment = new CodeAction(
            `Extract selected fields to new fragment component`,
            CodeActionKind.RefactorExtract
          );

          extractFragment.command = {
            title: "Add new fragment component",
            command: "vscode-rescript-relay.add-new-fragment-component",
            arguments: [
              document.uri,
              document.getText(),
              selection,
              {
                parentTypeName: extractedFragment.parentTypeName,
              },
              extractedFragment.selections,
              extractedFragment.targetSelection,
            ],
          };

          actions.push(extractFragment);
        }
      }

      if (
        (state.kind === "Field" || state.kind === "AliasedField") &&
        t instanceof GraphQLObjectType &&
        t.name.endsWith("Connection")
      ) {
        let hasConnectionDirective = false;

        visit(parsedOp, {
          Field(node) {
            runOnNodeAtPos(source, node, startPos, (n) => {
              if (nodeHasDirective(n, "connection")) {
                hasConnectionDirective = true;
              }

              return n;
            });
          },
        });

        if (!hasConnectionDirective) {
          // Full add pagination
          const addPagination = new CodeAction(
            `Set up pagination on "${state.name}" for fragment`,
            CodeActionKind.RefactorRewrite
          );

          addPagination.edit = makeReplaceOperationEdit(
            document.uri,
            selectedOp,
            visit(parsedOp, {
              FragmentDefinition(node) {
                return addDirectiveToNode(
                  addDirectiveToNode(node, "refetchable", [
                    {
                      kind: "Argument",
                      name: {
                        kind: "Name",
                        value: "queryName",
                      },
                      value: {
                        kind: "StringValue",
                        value: `${getModuleNameFromFile(
                          document.uri
                        )}PaginationQuery`,
                      },
                    },
                  ]),
                  "argumentDefinitions",
                  [
                    makeArgumentDefinitionVariable("first", "Int", "5"),
                    makeArgumentDefinitionVariable("after", "String"),
                  ]
                );
              },
              Field(node) {
                return runOnNodeAtPos(source, node, startPos, (n) => ({
                  ...addDirectiveToNode(n, "connection", [
                    {
                      kind: "Argument",
                      name: {
                        kind: "Name",
                        value: "key",
                      },
                      value: {
                        kind: "StringValue",
                        value: findPath(state)
                          .reverse()
                          .join("_"),
                      },
                    },
                  ]),
                  arguments: [
                    makeArgument("first", {
                      kind: "Variable",
                      name: {
                        kind: "Name",
                        value: "first",
                      },
                    }),
                    makeArgument("after", {
                      kind: "Variable",
                      name: {
                        kind: "Name",
                        value: "after",
                      },
                    }),
                  ],
                  selectionSet:
                    node.selectionSet && node.selectionSet.selections.length > 0
                      ? node.selectionSet
                      : makeSelectionSet([
                          makeFieldSelection("edges", [
                            makeFieldSelection("node", [
                              makeFieldSelection("id"),
                            ]),
                          ]),
                        ]),
                }));
              },
            })
          );

          actions.push(addPagination);
        }
      }

      if (firstDef && firstDef.kind === "OperationDefinition") {
        // @relay_test_operation
        if (!nodeHasDirective(firstDef, "relay_test_operation")) {
          const makeTestOperation = new CodeAction(
            "Make operation @relay_test_operation",
            CodeActionKind.RefactorRewrite
          );

          makeTestOperation.edit = makeReplaceOperationEdit(
            document.uri,
            selectedOp,
            visit(parsedOp, {
              FragmentDefinition(node) {
                return addDirectiveToNode(node, "relay_test_operation", []);
              },
            })
          );

          actions.push(makeTestOperation);
        }
      }

      if (
        t &&
        (t instanceof GraphQLUnionType || t instanceof GraphQLInterfaceType) &&
        state.kind === "Field"
      ) {
        let isExpanded = false;

        visit(parsedOp, {
          Field(node) {
            runOnNodeAtPos(source, node, startPos, (n) => {
              if (
                n.selectionSet &&
                n.selectionSet.selections.filter(
                  (s) => s.kind === "FragmentSpread"
                ).length > 0
              ) {
                isExpanded = true;
              }

              return n;
            });
          },
        });

        if (!isExpanded) {
          const expand = new CodeAction(
            `Expand ${
              t instanceof GraphQLUnionType ? "union" : "interface"
            } members on "${state.name}"`,
            CodeActionKind.RefactorRewrite
          );

          expand.edit = makeReplaceOperationEdit(
            document.uri,
            selectedOp,
            visit(parsedOp, {
              Field(node) {
                return runOnNodeAtPos(source, node, startPos, (n) => {
                  const typeNameNode: FieldNode = {
                    kind: "Field",
                    name: {
                      kind: "Name",
                      value: "__typename",
                    },
                  };

                  const memberNodes: InlineFragmentNode[] = schema
                    .getPossibleTypes(t)
                    .map(
                      (member: GraphQLObjectType): InlineFragmentNode => {
                        const firstField = getFirstField(member);

                        return {
                          kind: "InlineFragment",
                          typeCondition: {
                            kind: "NamedType",
                            name: {
                              kind: "Name",
                              value: member.name,
                            },
                          },
                          selectionSet: {
                            kind: "SelectionSet",
                            selections: [
                              {
                                kind: "Field",
                                name: {
                                  kind: "Name",
                                  value: firstField.name,
                                },
                              },
                            ],
                          },
                        };
                      }
                    );

                  const selectionSet: SelectionSetNode = {
                    kind: "SelectionSet",
                    selections: [typeNameNode, ...memberNodes],
                  };

                  return {
                    ...n,
                    selectionSet,
                  };
                });
              },
            })
          );

          actions.push(expand);
        }
      }

      if (firstDef && firstDef.kind === "FragmentDefinition") {
        // @argumentDefinitions
        if (state.kind === "Variable") {
          const { name } = state;

          if (
            name &&
            !nodeHasDirective(
              firstDef,
              "argumentDefinitions",
              (args) => !!args.find((a) => a.name.value === name)
            )
          ) {
            const { argDef } = typeInfo;

            if (argDef) {
              const addToArgumentDefinitions = new CodeAction(
                `Add "$${name}" to @argumentDefinitions`,
                CodeActionKind.RefactorRewrite
              );

              addToArgumentDefinitions.edit = makeReplaceOperationEdit(
                document.uri,
                selectedOp,
                visit(parsedOp, {
                  FragmentDefinition(node) {
                    return addDirectiveToNode(node, "argumentDefinitions", [
                      makeArgumentDefinitionVariable(
                        name,
                        argDef.type.toString()
                      ),
                    ]);
                  },
                })
              );

              actions.push(addToArgumentDefinitions);
            }
          }
        }

        // @inline
        if (!nodeHasDirective(firstDef, "inline")) {
          const addInline = new CodeAction(
            "Make fragment @inline",
            CodeActionKind.RefactorRewrite
          );

          addInline.edit = makeReplaceOperationEdit(
            document.uri,
            selectedOp,
            visit(parsedOp, {
              FragmentDefinition(node) {
                return addDirectiveToNode(node, "inline", []);
              },
            })
          );

          actions.push(addInline);
        }

        // @refetchable
        if (!nodeHasDirective(firstDef, "refetchable")) {
          const makeRefetchable = new CodeAction(
            "Make fragment @refetchable",
            CodeActionKind.RefactorRewrite
          );

          makeRefetchable.edit = makeReplaceOperationEdit(
            document.uri,
            selectedOp,
            visit(parsedOp, {
              FragmentDefinition(node) {
                return addDirectiveToNode(node, "refetchable", [
                  {
                    kind: "Argument",
                    name: {
                      kind: "Name",
                      value: "queryName",
                    },
                    value: {
                      kind: "StringValue",
                      value: `${getModuleNameFromFile(
                        document.uri
                      )}RefetchQuery`,
                    },
                  },
                ]);
              },
            })
          );

          actions.push(makeRefetchable);
        }

        // @relay(plural: true)
        if (
          !nodeHasDirective(
            firstDef,
            "relay",
            (args) => !!args.find((a) => a.name.value === "plural")
          )
        ) {
          const makePlural = new CodeAction(
            "Make fragment plural",
            CodeActionKind.RefactorRewrite
          );

          makePlural.edit = makeReplaceOperationEdit(
            document.uri,
            selectedOp,
            visit(parsedOp, {
              FragmentDefinition(node) {
                return addDirectiveToNode(node, "relay", [
                  {
                    kind: "Argument",
                    name: {
                      kind: "Name",
                      value: "plural",
                    },
                    value: {
                      kind: "BooleanValue",
                      value: true,
                    },
                  },
                ]);
              },
            })
          );

          actions.push(makePlural);
        }
      }

      return actions;
    },
  });
}

function initCommands(context: ExtensionContext): void {
  context.subscriptions.push(
    workspace.onWillSaveTextDocument((event) => {
      const openEditor = window.visibleTextEditors.filter(
        (editor) => editor.document.uri === event.document.uri
      )[0];

      if (openEditor) {
        formatDocument(openEditor);
      }
    }),
    commands.registerCommand(
      "vscode-rescript-relay.add-new-fragment-component",
      async (
        _uri: Uri,
        doc: string,
        selection: Range,
        typeInfo: GraphQLTypeAtPos,
        selectedNodes: SelectionNode[],
        targetSelection: SelectionSetNode
      ) => {
        const editor = window.activeTextEditor;
        const { loc: targetLoc } = targetSelection;

        if (!editor || !targetLoc) {
          return;
        }

        const selectedOperation = getSelectedGraphQLOperation(
          doc,
          selection.start
        );

        if (!selectedOperation) {
          return;
        }

        const newComponentName = await window.showInputBox({
          prompt: "Name of your new component",
          value: getModuleNameFromFile(editor.document.uri),
          validateInput(v: string): string | null {
            return /^[a-zA-Z0-9_]*$/.test(v)
              ? null
              : "Please only use alphanumeric characters and underscores.";
          },
        });

        if (!newComponentName) {
          window.showWarningMessage("Your component must have a name.");
          return;
        }

        const shouldRemoveSelection =
          (await window.showQuickPick(["Yes", "No"], {
            placeHolder:
              "Do you want to remove the selection from this fragment?",
          })) === "Yes";

        const shouldOpenFileDirectly =
          (await window.showQuickPick(["Yes", "No"], {
            placeHolder: "Do you want to open the new file directly?",
          })) === "Yes";

        const fragmentName = `${capitalize(newComponentName)}_${uncapitalize(
          typeInfo.parentTypeName
        )}`;

        const source = new Source(selectedOperation.content);
        const operationAst = parse(source);

        const updatedOperation = prettify(
          print(
            visit(operationAst, {
              SelectionSet(node) {
                const { loc } = node;

                if (!loc) {
                  return;
                }

                if (
                  loc.start === targetLoc.start &&
                  loc.end === targetLoc.end
                ) {
                  const newFragmentSelection: FragmentSpreadNode = {
                    kind: "FragmentSpread",
                    name: {
                      kind: "Name",
                      value: fragmentName,
                    },
                  };

                  return {
                    ...node,
                    selections: [
                      newFragmentSelection,
                      ...node.selections.reduce(
                        (acc: SelectionNode[], curr) => {
                          if (
                            shouldRemoveSelection &&
                            !!selectedNodes.find(
                              (s) =>
                                s.loc &&
                                curr.loc &&
                                s.loc.start === curr.loc.start &&
                                s.loc.end === curr.loc.end
                            )
                          ) {
                            return acc;
                          }

                          return [...acc, curr];
                        },
                        []
                      ),
                    ],
                  };
                }
              },
            })
          )
        );

        const currentFilePath = editor.document.uri.path;
        const thisFileName = path.basename(currentFilePath);

        const newFilePath = editor.document.uri.with({
          path: `${currentFilePath.slice(
            0,
            currentFilePath.length - thisFileName.length
          )}${newComponentName}.res`,
        });

        const newFragment = await makeFragment(
          fragmentName,
          typeInfo.parentTypeName,
          selectedNodes
        );

        fs.writeFileSync(
          newFilePath.fsPath,
          `module ${pascalCase(typeInfo.parentTypeName)}Fragment = %relay( 
  \`
${newFragment
  .split("\n")
  .map((s) => `  ${s}`)
  .join("\n")}
  \`
)

@react.component
let make = (~${uncapitalize(typeInfo.parentTypeName)}) => {
  let ${uncapitalize(typeInfo.parentTypeName)} = ${
            typeInfo.parentTypeName
          }Fragment.use(${uncapitalize(typeInfo.parentTypeName)})

  React.null
}`
        );

        const newDoc = await workspace.openTextDocument(newFilePath);
        await newDoc.save();

        const msg = `"${newComponentName}.res" was created with your new fragment.`;

        if (shouldOpenFileDirectly) {
          window.showInformationMessage(msg);
          window.showTextDocument(newDoc);
        } else {
          window.showInformationMessage(msg, "Open file").then((m) => {
            if (m) {
              window.showTextDocument(newDoc);
            }
          });
        }

        editor.selection = new Selection(
          new Position(
            editor.selection.active.line,
            editor.selection.active.character
          ),
          new Position(
            editor.selection.active.line,
            editor.selection.active.character
          )
        );

        await editor.edit((b) => {
          b.replace(
            new Range(
              new Position(
                selectedOperation.start.line,
                selectedOperation.start.character
              ),
              new Position(
                selectedOperation.end.line,
                selectedOperation.end.character
              )
            ),
            restoreOperationPadding(updatedOperation, selectedOperation.content)
          );
        });

        await editor.document.save();
      }
    ),
    commands.registerCommand("vscode-rescript-relay.add-fragment", () =>
      addGraphQLComponent("Fragment")
    ),
    commands.registerCommand("vscode-rescript-relay.add-query", () =>
      addGraphQLComponent("Query")
    ),
    commands.registerCommand("vscode-rescript-relay.add-mutation", () =>
      addGraphQLComponent("Mutation")
    ),
    commands.registerCommand("vscode-rescript-relay.add-subscription", () =>
      addGraphQLComponent("Subscription")
    ),
    commands.registerCommand(
      "vscode-rescript-relay.wrap-in-suspense-boundary",
      () => {
        const start = `<React.Suspense fallback={<div />}>`;
        const end = `</React.Suspense>`;

        wrapInJsx(start, end, start.indexOf("<div />"));
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.wrap-in-suspense-list",
      () => {
        const start = `<React.SuspenseList revealOrder=#forwards>`;
        const end = `</React.SuspenseList>`;

        wrapInJsx(start, end, start.length);
      }
    )
  );
}

function initLanguageServer(
  context: ExtensionContext,
  outputChannel: OutputChannel
): { client: LanguageClient; disposableClient: Disposable } {
  const serverModule = context.asAbsolutePath(path.join("build", "server.js"));
  const currentWorkspacePath = getCurrentWorkspaceRoot();

  if (!currentWorkspacePath) {
    throw new Error("Not inside a workspace.");
  }

  let serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        env: { ROOT_DIR: currentWorkspacePath },
      },
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        env: { ROOT_DIR: currentWorkspacePath },
      },
    },
  };

  let clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "graphql" },
      { scheme: "file", language: "rescript" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.res"),
    },
    outputChannel: outputChannel,
    outputChannelName: "ReScriptRelay GraphQL Language Server",
    revealOutputChannelOn: RevealOutputChannelOn.Never,
    middleware: {
      handleDiagnostics(
        this: void,
        uri: Uri,
        d: Diagnostic[],
        next: HandleDiagnosticsSignature
      ): void {
        next(
          uri,
          d.filter(
            (dia) =>
              !dia.message.includes("Unknown argument") &&
              !dia.message.includes('on directive "@argumentDefinitions"')
          )
        );
      },
    },
  };

  const client = new LanguageClient(
    "vscode-rescript-relay",
    "ReScriptRelay GraphQL Language Server",
    serverOptions,
    clientOptions
  );

  const disposableClient = client.start();
  context.subscriptions.push(disposableClient);

  return { client, disposableClient };
}

export async function activate(context: ExtensionContext) {
  if (!(await isReScriptRelayProject())) {
    return;
  }

  let outputChannel: OutputChannel = window.createOutputChannel(
    "ReScriptRelay GraphQL Language Server"
  );

  let client: LanguageClient | undefined;
  let clientDisposable: Disposable | undefined;

  const relayConfig = await loadRelayConfig();
  const graphqlConfig = await loadGraphQLConfig();

  async function initClient() {
    if (client) {
      await client.stop();
    }

    if (clientDisposable) {
      clientDisposable.dispose();
    }

    const inited = initLanguageServer(context, outputChannel);
    client = inited.client;
    clientDisposable = inited.disposableClient;
  }

  await initClient();
  initCommands(context);
  initHoverProviders();

  const schemaWatcher = workspace.createFileSystemWatcher("**/*.graphql");

  schemaWatcher.onDidChange((e) => {
    if (workspace.workspaceFolders) {
      workspace.workspaceFolders.forEach(async (f) => {
        if (e.fsPath.startsWith(f.uri.fsPath)) {
          window.withProgress(
            {
              location: ProgressLocation.Notification,
              title: "Changes to schema detected. Refreshing...",
              cancellable: false,
            },
            async () => {
              await cacheControl.refresh(f.uri.fsPath);
              await initClient();
            }
          );
        }
      });
    }
  });

  context.subscriptions.push(
    workspace.onDidChangeWorkspaceFolders((e) => {
      e.removed.forEach((f) => {
        cacheControl.remove(f.uri.fsPath);
      });
    }),
    schemaWatcher
  );

  if (relayConfig && graphqlConfig) {
    let relayCompilerOutputChannel: OutputChannel = window.createOutputChannel(
      "Relay Compiler"
    );

    context.subscriptions.push(
      commands.registerCommand(
        "vscode-rescript-relay.show-relay-compiler-output",
        () => {
          relayCompilerOutputChannel.show();
        }
      )
    );

    let childProcess: cp.ChildProcessWithoutNullStreams | undefined;

    const item = window.createStatusBarItem(StatusBarAlignment.Right);

    function setStatusBarItemText(text: string) {
      const lastText = item.text;
      item.text = text;

      return () => {
        item.text = lastText;
      };
    }

    function setStatusBarItemToStart() {
      setStatusBarItemText("$(debug-start) Start Relay compiler");
      item.command = "vscode-rescript-relay.start-compiler";
    }

    function setStatusBarItemToStop() {
      setStatusBarItemText("$(debug-stop) Relay Compiler running");
      item.command = "vscode-rescript-relay.stop-compiler";
      item.tooltip = "Click to stop";
    }

    function setStatusBarItemToWroteFiles() {
      setStatusBarItemText("$(debug-stop) $(check) Relay Compiler recompiled");
      item.command = "vscode-rescript-relay.show-relay-compiler-output";
      item.tooltip = "Click to see full output";
    }

    function setStatusBarItemToError() {
      setStatusBarItemText("$(error) Error!");
      item.command = "vscode-rescript-relay.show-relay-compiler-output";
      item.tooltip = "Click to see full output";
    }

    setStatusBarItemToStart();
    item.show();

    context.subscriptions.push(
      relayCompilerOutputChannel,
      commands.registerCommand("vscode-rescript-relay.start-compiler", () => {
        childProcess = cp.spawn(
          // TODO: Do a more robust solution for the PATH that also works with Windows
          "PATH=$PATH:./node_modules/.bin reason-relay-compiler",
          ["--watch"],
          {
            cwd: graphqlConfig.dirpath,
            shell: true,
          }
        );

        let errorBuffer: string | undefined;
        let hasHadError: boolean = false;
        let statusBarMessageTimeout: any = null;

        if (childProcess.pid) {
          childProcess.stdout.on("data", (data: Buffer) => {
            const str = data.toString();

            if (/(Created|Updated|Deleted|Unchanged):/g.test(str)) {
              if (hasHadError) {
                setStatusBarItemText("$(check) Back to normal");
                setTimeout(() => {
                  setStatusBarItemToStop();
                }, 3000);
                hasHadError = false;
              }

              // We don't want to alert that things changed if they didn't
              if (/(Created|Updated|Deleted):/g.test(str)) {
                clearTimeout(statusBarMessageTimeout);
                setStatusBarItemToWroteFiles();
                statusBarMessageTimeout = setTimeout(() => {
                  setStatusBarItemToStop();
                }, 3000);
              }
            }

            // Error detected or already in buffer, add to the error buffer
            if (str.includes("ERROR:") || errorBuffer) {
              errorBuffer += str;
            }

            if (errorBuffer) {
              const error = /(?<=ERROR:)([\s\S]*?)(?=Watching for changes )/g.exec(
                errorBuffer
              );

              if (error && error[0]) {
                setStatusBarItemToError();

                // Reset error buffer
                errorBuffer = undefined;
                hasHadError = true;
              }
            }

            relayCompilerOutputChannel.append(str);
          });

          childProcess.stdout.on("error", (e) => {
            window.showErrorMessage(e.message);
          });

          childProcess.stdout.on("close", () => {
            window.showInformationMessage(
              "The Relay compiler has been shut down."
            );
            childProcess = undefined;
            setStatusBarItemToStart();
          });

          childProcess.stderr.on("error", (e) => {
            window.showErrorMessage(e.message);
          });

          childProcess.stdout.on("end", () => {
            window.showInformationMessage(
              "The Relay compiler has been shut down."
            );
            childProcess = undefined;
            setStatusBarItemToStart();
          });

          setStatusBarItemToStop();
        }
      }),
      commands.registerCommand("vscode-rescript-relay.stop-compiler", () => {
        if (childProcess && childProcess.pid && childProcess.kill()) {
          setStatusBarItemToStart();
        } else {
          window.showWarningMessage("Could not stop the Relay compiler.");
        }

        childProcess = undefined;
      })
    );

    const relayConfigWatcher = workspace.createFileSystemWatcher(
      graphqlConfig.filepath
    );

    relayConfigWatcher.onDidChange(async () => {
      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: "relay.config.js changed, refreshing...",
          cancellable: false,
        },
        async () => {
          await initClient();
          await commands.executeCommand("vscode-rescript-relay.stop-compiler");
          await commands.executeCommand("vscode-rescript-relay.start-compiler");
        }
      );
    });

    // Autostart the compiler if wanted
    if (
      workspace.getConfiguration("rescript-relay").get("autoStartRelayCompiler")
    ) {
      await commands.executeCommand("vscode-rescript-relay.start-compiler");
    }
  }
}

export function deactivate() {
  console.log('Extension "vscode-rescript-relay" is now de-activated!');
}
