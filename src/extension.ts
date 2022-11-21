import * as cp from "child_process";
import watchman from "fb-watchman";
import * as fs from "fs";
import {
  ArgumentNode,
  ASTNode,
  FieldNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  getLocation,
  getNamedType,
  GraphQLCompositeType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLUnionType,
  InlineFragmentNode,
  isCompositeType,
  OperationDefinitionNode,
  parse,
  print,
  SelectionNode,
  SelectionSetNode,
  Source,
  visit,
} from "graphql";
import {
  getTokenAtPosition,
  getTypeInfo,
} from "graphql-language-service-interface/dist/getAutocompleteSuggestions";
import { Position as GraphQLPosition } from "graphql-language-service-utils";
import { pascalCase } from "pascal-case";
import * as path from "path";
import {
  CodeAction,
  CodeActionKind,
  commands,
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  env,
  ExtensionContext,
  Hover,
  languages,
  Location,
  MarkdownString,
  OutputChannel,
  Position,
  ProgressLocation,
  Range,
  Selection,
  TextEdit,
  TextEditor,
  TextEditorEdit,
  Uri,
  ViewColumn,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import {
  Command,
  Disposable,
  HandleDiagnosticsSignature,
  LanguageClient,
  LanguageClientOptions,
  RevealOutputChannelOn,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { addGraphQLComponent } from "./addGraphQLComponent";
import { complete, findContext, getFragmentDefinition } from "./contextUtils";
import {
  addFieldAtPosition,
  addFragmentSpreadAtPosition,
  findGraphQLRecordContext,
  findRecordAndModulesFromCompletion,
  getConnectionKeyName,
  GraphQLRecordCtx,
  GraphQLType,
  namedTypeToString,
} from "./contextUtilsNoVscode";
import {
  addFragmentHere,
  extractToFragment,
} from "./createNewFragmentComponentsUtils";
import { GraphQLSource, GraphQLSourceFromTag } from "./extensionTypes";
import {
  copyComponentCodeToClipboard,
  createCompletionItemsForFragmentSpreads,
  fillInFileDataForFragmentSpreadCompletionItems,
  FragmentCreationSource,
  fragmentCreationWizard,
  getModuleNameFromFile,
  getNormalizedSelection,
  makeNewFragmentComponentJsx,
  openFileAndShowMessage,
  openPosInDoc,
  prettify,
  restoreOperationPadding,
  uncapitalize,
  wrapInJsx,
} from "./extensionUtils";
import { extractFragmentRefs } from "./extensionUtilsNoVscode";
import {
  extractGraphQLSources,
  getSelectedGraphQLOperation,
} from "./findGraphQLSources";
import {
  addDirectiveToNode,
  findPath,
  getAdjustedPosition,
  getFragmentComponentText,
  getNewFilePath,
  makeArgument,
  makeArgumentDefinitionVariable,
  makeConnectionsVariable,
  makeFragment,
  makeVariableDefinitionNode,
  nodeHasDirective,
  nodeHasVariable,
  runOnNodeAtPos,
} from "./graphqlUtils";
import {
  getFirstField,
  makeFieldSelection,
  makeSelectionSet,
} from "./graphqlUtilsNoVscode";
import {
  cacheControl,
  getCurrentWorkspaceRoot,
  isReScriptRelayProject,
  loadFullSchema,
  loadGraphQLConfig,
  loadRelayConfig,
} from "./loadSchema";
import {
  routerLspMatchUrl,
  routerLspRoutesForFile,
  SingleRoute,
} from "./lspUtils";
import { featureEnabled, getPreferredFragmentPropName } from "./utils";

let lastMatchedUrl = "";

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

  const sources = extractGraphQLSources(textEditor.document.getText());

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

function initProviders(_context: ExtensionContext) {
  // Insert fragments etc
  languages.registerCompletionItemProvider("rescript", {
    async provideCompletionItems(document, selection) {
      if (!featureEnabled("contextualCompletions")) {
        return null;
      }

      const selectedOp = getSelectedGraphQLOperation(
        document.getText(),
        selection
      );

      // Don't run inside of GraphQL operations
      if (selectedOp != null) {
        return null;
      }

      const completion = complete(document, selection);

      if (completion != null) {
        const schema = await loadFullSchema();

        if (schema == null) {
          return null;
        }

        let operationsInDoc: GraphQLSource[] | null = extractGraphQLSources(
          document.getText()
        );

        const cached = new Map<string, GraphQLRecordCtx>();

        const items = completion
          .map(findRecordAndModulesFromCompletion)
          .reduce((acc: CompletionItem[], curr) => {
            if (curr != null) {
              const targetOp = operationsInDoc?.find(
                (op) =>
                  op.type === "TAG" &&
                  op.content.includes(`${curr.graphqlType} ${curr.graphqlName}`)
              ) as GraphQLSourceFromTag | undefined;

              if (targetOp == null) {
                return acc;
              }

              if (cached.get(curr.graphqlName) == null) {
                const ctx = findGraphQLRecordContext(
                  targetOp.content,
                  curr.recordName,
                  schema,
                  curr.graphqlType
                );

                if (ctx != null) {
                  cached.set(curr.graphqlName, ctx);
                }
              }

              const ctx = cached.get(curr.graphqlName);

              if (ctx == null) {
                return acc;
              }

              const fragmentSpreads = (ctx.astNode?.selectionSet?.selections.filter(
                (s) =>
                  s.kind === "FragmentSpread" &&
                  !s.directives?.some((d) => d.name.value === "inline")
              ) ?? []) as FragmentSpreadNode[];

              const completionItems = createCompletionItemsForFragmentSpreads(
                curr.label,
                fragmentSpreads.map((node) => node.name.value)
              );

              acc.push(...completionItems);
            }

            return acc;
          }, []);

        // Now fill in all file data
        return fillInFileDataForFragmentSpreadCompletionItems(items);
      }

      return null;
    },
  });

  languages.registerCompletionItemProvider(
    "rescript",
    {
      async provideCompletionItems(document, selection) {
        if (!featureEnabled("contextualCompletions")) {
          return null;
        }

        const selectedOp = getSelectedGraphQLOperation(
          document.getText(),
          selection
        );

        // Don't run inside of GraphQL operations
        if (selectedOp != null) {
          return null;
        }

        const completion = complete(document, selection);

        if (completion != null) {
          const schema = await loadFullSchema();

          if (schema == null) {
            return null;
          }

          const fragmentRefs = completion.find(
            (c) => c.label === "fragmentRefs"
          );

          if (fragmentRefs != null) {
            const frefs = extractFragmentRefs(fragmentRefs.detail);

            const completionItems = createCompletionItemsForFragmentSpreads(
              "fragment",
              frefs
            );

            return fillInFileDataForFragmentSpreadCompletionItems(
              completionItems,
              true
            );
          }
        }

        return null;
      },
    },
    "."
  );

  // Jump to definition for various things
  languages.registerDefinitionProvider("rescript", {
    async provideDefinition(document, position) {
      /**
       * Special handling of things in GraphQL tags.
       */
      const op = getSelectedGraphQLOperation(document.getText(), position);

      if (op != null) {
        const selectedText = document.getWordRangeAtPosition(position);
        if (selectedText != null) {
          const isThisAFragmentSpread =
            document.getText(
              new Range(
                new Position(
                  selectedText.start.line,
                  selectedText.start.character - 3
                ),
                selectedText.start
              )
            ) === "...";

          if (isThisAFragmentSpread) {
            const fragmentName = document.getText(selectedText);
            const fragmentDef = await getFragmentDefinition(fragmentName);

            if (fragmentDef != null) {
              return [
                {
                  targetUri: fragmentDef.fileLocation,
                  targetRange: new Range(
                    new Position(
                      fragmentDef.tag.start.line,
                      fragmentDef.tag.start.character
                    ),
                    new Position(
                      fragmentDef.tag.end.line,
                      fragmentDef.tag.end.character
                    )
                  ),
                },
              ];
            }
          }
        }
      }

      return null;
    },
  });

  // Autoinsert GraphQL field completions
  languages.registerCompletionItemProvider(
    "rescript",
    {
      async provideCompletionItems(document, selection) {
        if (!featureEnabled("autocompleteUnselectedGraphQLFields")) {
          return null;
        }

        const ctxPos = new Position(selection.line, selection.character - 1);

        const ctx = await findContext(document, ctxPos);

        if (ctx?.type !== "GraphQLValueContext") {
          return;
        }

        const schema = await loadFullSchema();

        if (schema == null) {
          return;
        }

        const positionCtx = findGraphQLRecordContext(
          ctx.tag.content,
          ctx.recordName,
          schema,
          ctx.graphqlType
        );

        if (positionCtx == null) {
          return;
        }

        if (
          positionCtx.type instanceof GraphQLObjectType ||
          positionCtx.type instanceof GraphQLInterfaceType
        ) {
          const existingFieldSelectionNames =
            positionCtx.astNode?.selectionSet?.selections
              .filter((s) => s.kind === "Field")
              .map((s) => (s.kind === "Field" ? s.name.value : "")) ?? [];

          const fields = Object.values(positionCtx.type.getFields()).filter(
            (field) => !existingFieldSelectionNames.includes(field.name)
          );

          return fields.map((field) => {
            const key = field.name;
            const item = new CompletionItem(key);
            item.kind = CompletionItemKind.Constant;

            item.sortText = `zzzzz ${key}`;
            const docs = new MarkdownString(
              `${field.type.toString()}: \`${key}\`\n`
            );

            if (field.description != null) {
              docs.appendMarkdown(`\n_${field.description}_\n`);
            }

            docs.appendMarkdown(
              `\nAdd field \`${key}\` to \`${ctx.graphqlName}\` and use it`
            );
            item.documentation = docs;

            // @ts-ignore
            item.__extra = {
              ctx,
              positionCtx,
            };

            return item;
          });
        }
      },

      // Leverage resolve as we don't want to calculate changed operations for
      // every single item in the completion list.
      resolveCompletionItem(item) {
        const key = item.label;

        item.additionalTextEdits = [
          TextEdit.replace(
            new Range(
              new Position(
                // @ts-ignore
                item.__extra.ctx.tag.start.line,
                // @ts-ignore
                item.__extra.ctx.tag.start.character
              ),
              new Position(
                // @ts-ignore
                item.__extra.ctx.tag.end.line,
                // @ts-ignore
                item.__extra.ctx.tag.end.character
              )
            ),
            restoreOperationPadding(
              prettify(
                print(
                  addFieldAtPosition(
                    // @ts-ignore
                    item.__extra.positionCtx.parsedSource,
                    // @ts-ignore
                    item.__extra.ctx.recordName,
                    // @ts-ignore
                    item.__extra.positionCtx.type,
                    key.toString(),
                    // @ts-ignore
                    item.__extra.ctx.graphqlType
                  )
                )
              ),
              // @ts-ignore
              item.__extra.ctx.tag.content
            )
          ),
        ];
        return item;
      },
    },
    "."
  );

  // Handle pipe completions
  languages.registerCompletionItemProvider(
    "rescript",
    {
      async provideCompletionItems(document, selection) {
        if (!featureEnabled("contextualCompletions")) {
          return null;
        }

        const selectedOp = getSelectedGraphQLOperation(
          document.getText(),
          selection
        );

        // Don't run inside of GraphQL operations
        if (selectedOp != null) {
          return null;
        }

        // First, check whether the character before > is - (meaning it's a pipe)
        const posBehindPipe = new Position(
          selection.line,
          selection.character - 2
        );

        const char = document.getText(
          new Range(
            posBehindPipe,
            new Position(selection.line, selection.character - 1)
          )
        );

        if (char !== "-") {
          return [];
        }

        const ctxPos = posBehindPipe;

        const ctx = await findContext(document, ctxPos);

        if (ctx == null) {
          return;
        }

        const schema = await loadFullSchema();

        if (schema == null) {
          return;
        }

        if (ctx.type === "GraphQLValueContext") {
          const positionCtx = findGraphQLRecordContext(
            ctx.tag.content,
            ctx.recordName,
            schema,
            ctx.graphqlType
          );

          if (positionCtx == null) {
            return;
          }

          if (
            positionCtx.astNode?.kind === "Field" &&
            positionCtx.astNode.directives?.some(
              (d) => d.name.value === "connection"
            )
          ) {
            const item = new CompletionItem(
              `${ctx.tag.moduleName}.getConnectionNodes`
            );
            item.documentation = new MarkdownString(
              `Collect all \`nodes\` to a non-optional array you can iterate on.`
            );
            item.preselect = true;

            return [item];
          }
        }

        if (ctx.type === "RescriptRelayValueContext") {
          const item = new CompletionItem(`RescriptRelay.dataIdToString`);
          item.documentation = new MarkdownString(
            `Convert a \`dataId\` to \`string\`.`
          );
          item.preselect = true;

          return [item];
        }
      },
    },
    ">"
  );

  languages.registerHoverProvider("rescript", {
    async provideHover(document, position) {
      if (!featureEnabled("contextualHoverInfo")) {
        return null;
      }

      const selectedOp = getSelectedGraphQLOperation(
        document.getText(),
        position
      );

      // Don't run inside of GraphQL operations
      if (selectedOp != null) {
        return null;
      }

      try {
        const ctx = await findContext(document, position, true);

        if (ctx == null) {
          return;
        }

        const schema = await loadFullSchema();

        if (schema == null) {
          return;
        }

        if (ctx.type === "GraphQLValueContext") {
          const positionCtx = findGraphQLRecordContext(
            ctx.tag.content,
            ctx.recordName,
            schema,
            ctx.graphqlType
          );

          if (positionCtx == null) {
            return;
          }

          const relayConfig = await loadRelayConfig();

          if (relayConfig == null) {
            return;
          }

          const hovers: MarkdownString[] = [];

          const type = positionCtx.type;

          /**
           * Handle schema documentation
           */
          let graphqlSchemaDocHover = new MarkdownString();
          graphqlSchemaDocHover.isTrusted = true;

          const astNode = type.astNode;

          if (astNode != null && astNode.loc != null) {
            const startLoc = getLocation(astNode.loc.source, astNode.loc.start);

            const openGraphQLSchemaArgs = [startLoc.line, startLoc.line];

            const openGraphQLSchemaCommand = Uri.parse(
              `command:vscode-rescript-relay.open-graphql-schema?${encodeURIComponent(
                JSON.stringify(openGraphQLSchemaArgs)
              )}`
            );

            graphqlSchemaDocHover.appendMarkdown(
              `[${positionCtx.fieldTypeAsString}](${openGraphQLSchemaCommand})`
            );
          } else {
            graphqlSchemaDocHover.appendMarkdown(
              `${positionCtx.fieldTypeAsString}`
            );
          }

          graphqlSchemaDocHover.appendMarkdown(
            ` (${namedTypeToString(positionCtx.type)})`
          );

          if (positionCtx.type.description != null) {
            graphqlSchemaDocHover.appendMarkdown(
              `: _${positionCtx.description}_`
            );
          }

          hovers.push(graphqlSchemaDocHover);

          /**
           * Handle contextual navigation
           */

          const startPos = getAdjustedPosition(ctx.tag, positionCtx?.startLoc);

          const goToGraphQLDefinitionArgs = [
            Uri.parse(ctx.sourceFilePath),
            startPos.line,
            startPos.character,
          ];

          const goToGraphQLDefinitionCommand = Uri.parse(
            `command:vscode-rescript-relay.goto-pos-in-doc?${encodeURIComponent(
              JSON.stringify(goToGraphQLDefinitionArgs)
            )}`
          );

          let graphqlDefinitionHover = new MarkdownString(
            `Go to definition of \`${ctx.propName}\` in [${ctx.graphqlName}](${goToGraphQLDefinitionCommand})`
          );
          graphqlDefinitionHover.isTrusted = true;

          hovers.push(graphqlDefinitionHover);

          return new Hover(hovers);
        }

        if (ctx.type === "RescriptRelayValueContext") {
          return new Hover(
            new MarkdownString(
              `Hint: You can convert a \`dataId\` to \`string\` via \`RescriptRelay.dataIdToString\`.`
            )
          );
        }
      } catch (e) {
        window.showInformationMessage(e.message);
      }
    },
  });

  languages.registerCodeActionsProvider("rescript", {
    async provideCodeActions(
      document,
      selection
    ): Promise<(CodeAction | Command)[] | undefined | null> {
      if (!featureEnabled("contextualCompletions")) {
        return null;
      }

      const selectedOp = getSelectedGraphQLOperation(
        document.getText(),
        selection instanceof Range ? selection.start : selection
      );

      // Don't run inside of GraphQL operations
      if (selectedOp != null) {
        return null;
      }

      const ctx = await findContext(document, selection, true);

      if (ctx?.type !== "GraphQLValueContext") {
        return;
      }

      const isInOpenedFile = ctx.sourceFilePath === document.uri.fsPath;

      const schema = await loadFullSchema();

      if (schema == null) {
        return;
      }

      const positionCtx = findGraphQLRecordContext(
        ctx.tag.content,
        ctx.recordName,
        schema,
        ctx.graphqlType
      );

      const actions = [];

      // Add new fragment here
      if (
        isInOpenedFile &&
        (positionCtx?.type instanceof GraphQLObjectType ||
          positionCtx?.type instanceof GraphQLInterfaceType ||
          positionCtx?.type instanceof GraphQLUnionType)
      ) {
        const addNewFragmentHere = new CodeAction(
          `Add new fragment to "${ctx.propName}"`,
          CodeActionKind.Refactor
        );

        addNewFragmentHere.command = {
          title: "Add new fragment component",
          command: "vscode-rescript-relay.add-new-fragment-component-to-value",
          arguments: [
            document.uri,
            document.getText(),
            selection,
            ctx.tag,
            positionCtx.type,
            ctx.recordName,
            ctx.propName,
            ctx.graphqlType,
          ],
        };

        actions.push(addNewFragmentHere);
      }

      if (isInOpenedFile) {
        // Peek fragment
        const peekFragment = new CodeAction(
          `Peek this value in "${ctx.graphqlName}"`,
          CodeActionKind.Empty
        );

        peekFragment.command = {
          title: "Peek definition",
          command: "editor.action.peekLocations",
          arguments: [
            Uri.parse(ctx.sourceFilePath),
            selection.start,
            [
              new Location(
                document.uri,
                new Range(
                  getAdjustedPosition(ctx.tag, positionCtx?.startLoc),
                  getAdjustedPosition(ctx.tag, positionCtx?.endLoc)
                )
              ),
            ],
            "peek",
          ],
        };

        actions.push(peekFragment);
      }

      // Go to GraphQL
      const goToGraphql = new CodeAction(
        `Go to definition of "${ctx.graphqlName}"`,
        CodeActionKind.Empty
      );

      goToGraphql.command = {
        title: "Go to definition",
        command: "editor.action.goToLocations",
        arguments: [
          Uri.parse(ctx.sourceFilePath),
          getAdjustedPosition(ctx.tag, positionCtx?.startLoc),
          [],
          "goto",
        ],
      };

      actions.push(goToGraphql);

      return actions;
    },
  });

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

      // Add current variable to operation variables
      if (firstDef && firstDef.kind === "OperationDefinition") {
        if (
          state.kind === "Variable" &&
          state.name &&
          !nodeHasVariable(firstDef, state.name)
        ) {
          const argDef = typeInfo.argDef;

          if (argDef) {
            const variableDefinitionNode = makeVariableDefinitionNode(
              state.name,
              argDef.type.toString()
            );

            const addToOperationVariables = new CodeAction(
              `Add "$${state.name}" to operation variables`,
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

      // Extracting to new fragments
      if (
        parentT &&
        (parentT instanceof GraphQLObjectType ||
          parentT instanceof GraphQLInterfaceType ||
          parentT instanceof GraphQLUnionType)
      ) {
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
            command: "vscode-rescript-relay.extract-to-new-fragment-component",
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

        const canAddFragmentHere = addFragmentHere({
          parsedOp,
          schema,
          normalizedSelection: getNormalizedSelection(selection, selectedOp),
          source,
        });
        if (canAddFragmentHere) {
          // Adding a new fragment component
          const addFragmentHereAction = new CodeAction(
            `Add new fragment component ${
              canAddFragmentHere.addBeforeThisSelection ? "here" : "to the root"
            }`,
            CodeActionKind.Refactor
          );

          addFragmentHereAction.command = {
            title: "Add new fragment component",
            command: "vscode-rescript-relay.extract-to-new-fragment-component",
            arguments: [
              document.uri,
              document.getText(),
              selection,
              {
                parentTypeName: canAddFragmentHere.parentTypeName,
              },
              canAddFragmentHere.addBeforeThisSelection,
              canAddFragmentHere.targetSelection,
            ],
          };

          actions.push(addFragmentHereAction);
        }
      }

      // Connection stuff
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
                        value: findPath(state).reverse().join("_"),
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

          // Add @connection
          const addConnectionDirective = new CodeAction(
            `Add @connection to "${state.name}"`,
            CodeActionKind.RefactorRewrite
          );

          addConnectionDirective.edit = makeReplaceOperationEdit(
            document.uri,
            selectedOp,
            visit(parsedOp, {
              Field(node, _b, _c, _d, ancestors) {
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
                        value: getConnectionKeyName(
                          ancestors,
                          node,
                          firstDef.kind === "FragmentDefinition"
                            ? firstDef.name.value
                            : "unknown"
                        ),
                      },
                    },
                  ]),
                  arguments: [
                    ...(n.arguments ?? []),
                    n.arguments?.some((arg) => arg.name.value === "first")
                      ? null
                      : makeArgument("first", {
                          kind: "IntValue",
                          value: "200",
                        }),
                  ].filter(Boolean) as ArgumentNode[],
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

          actions.push(addConnectionDirective);
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

      // Store updaters
      if (
        firstDef &&
        firstDef.kind === "OperationDefinition" &&
        (firstDef.operation === "mutation" ||
          firstDef.operation === "subscription")
      ) {
        const directives: string[] = [];

        if (
          (state.kind === "Field" || state.kind === "AliasedField") &&
          t &&
          getNamedType(t).name === "ID"
        ) {
          visit(parsedOp, {
            Field(node) {
              runOnNodeAtPos(source, node, startPos, (n) => {
                if (!nodeHasDirective(n, "deleteEdge")) {
                  directives.push("deleteEdge");
                }

                if (!nodeHasDirective(n, "deleteRecord")) {
                  directives.push("deleteRecord");
                }

                return n;
              });
            },
          });
        }

        if (
          (state.kind === "Field" || state.kind === "AliasedField") &&
          t instanceof GraphQLObjectType
        ) {
          if (t.name.toLowerCase().endsWith("edge")) {
            // @append/prependEdge
            visit(parsedOp, {
              Field(node) {
                runOnNodeAtPos(source, node, startPos, (n) => {
                  if (!nodeHasDirective(n, "appendEdge")) {
                    directives.push("appendEdge");
                  }

                  if (!nodeHasDirective(n, "prependEdge")) {
                    directives.push("prependEdge");
                  }

                  return n;
                });
              },
            });
          } else {
            // @append/prependNode
            visit(parsedOp, {
              Field(node) {
                runOnNodeAtPos(source, node, startPos, (n) => {
                  if (!nodeHasDirective(n, "appendNode")) {
                    directives.push("appendNode");
                  }

                  if (!nodeHasDirective(n, "prependNode")) {
                    directives.push("prependNode");
                  }

                  return n;
                });
              },
            });
          }
        }

        if (directives.length > 0 && t) {
          directives.forEach((dir) => {
            const action = new CodeAction(
              `Add @${dir}`,
              CodeActionKind.RefactorRewrite
            );

            action.edit = makeReplaceOperationEdit(
              document.uri,
              selectedOp,
              visit(parsedOp, {
                OperationDefinition(op): OperationDefinitionNode {
                  if (
                    dir === "deleteRecord" ||
                    op.variableDefinitions?.some(
                      (v) => v.variable.name.value === "connections"
                    )
                  ) {
                    return op;
                  }

                  return {
                    ...op,
                    variableDefinitions: makeConnectionsVariable(op),
                  };
                },
                Field(node) {
                  return runOnNodeAtPos(
                    source,
                    node,
                    startPos,
                    (n): FieldNode => {
                      const connectionArg: ArgumentNode = {
                        kind: "Argument",
                        name: { kind: "Name", value: "connections" },
                        value: {
                          kind: "Variable",
                          name: {
                            value: "connections",
                            kind: "Name",
                          },
                        },
                      };

                      return {
                        ...n,
                        directives: [
                          ...(n.directives ?? []),
                          {
                            kind: "Directive",
                            name: { kind: "Name", value: dir },
                            arguments:
                              dir === "deleteRecord"
                                ? []
                                : ["appendNode", "prependNode"].includes(dir)
                                ? [
                                    connectionArg,
                                    {
                                      kind: "Argument",
                                      name: {
                                        kind: "Name",
                                        value: "edgeTypeName",
                                      },
                                      value: {
                                        kind: "StringValue",
                                        value: `${t.name}Edge`,
                                      },
                                    },
                                  ]
                                : [connectionArg],
                          },
                        ],
                      };
                    }
                  );
                },
              })
            );

            actions.push(action);
          });
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

      // Open source file for fragment spread
      if (state.kind === "FragmentSpread") {
        const openSourceFile = new CodeAction(
          `Open source ReScript file defining '${state.name}''`
        );

        openSourceFile.command = {
          command: "vscode-rescript-relay.open-source-res-file-for-operation",
          title: "",
          arguments: [state.name],
        };

        actions.push(openSourceFile);
      }

      // Open generated file for op
      if (
        firstDef &&
        (firstDef.kind === "OperationDefinition" ||
          firstDef.kind === "FragmentDefinition") &&
        firstDef.name?.value != null
      ) {
        const openGeneratedFileAction = new CodeAction(
          `Open generated Relay file for '${firstDef.name.value}''`
        );

        openGeneratedFileAction.command = {
          command: "vscode-rescript-relay.open-generated-file-for-operation",
          title: "",
          arguments: [firstDef.name.value],
        };

        actions.push(openGeneratedFileAction);
      }

      return actions;
    },
  });
}

function initCommands(
  context: ExtensionContext,
  routerLspClient: LanguageClient | undefined
): void {
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
      "vscode-rescript-relay.extract-to-new-fragment-component",
      async (
        uri: Uri,
        doc: string,
        selection: Range,
        typeInfo: GraphQLTypeAtPos,
        selectedNodeOrNodes: SelectionNode[] | SelectionNode | null,
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

        const schema = await loadFullSchema();

        if (schema == null) {
          return;
        }

        const type = schema.getType(typeInfo.parentTypeName);

        if (type == null || !isCompositeType(type)) {
          return;
        }

        const newFragmentProps = await fragmentCreationWizard({
          selectedVariableName: uncapitalize(
            getPreferredFragmentPropName(type.name)
          ),
          type,
          uri,
          source: FragmentCreationSource.GraphQLTag,
        });

        if (newFragmentProps == null) {
          return;
        }

        const {
          variableName,
          newComponentName,
          shouldOpenFile,
          fragmentName,
          copyToClipboard,
          shouldRemoveSelection,
        } = newFragmentProps;

        const source = new Source(selectedOperation.content);
        const operationAst = parse(source);

        const newFragmentSelection: FragmentSpreadNode = {
          kind: "FragmentSpread",
          name: {
            kind: "Name",
            value: fragmentName,
          },
        };

        const updatedOperation = prettify(
          print(
            visit(operationAst, {
              FragmentDefinition(node): FragmentDefinitionNode {
                if (!selectedNodeOrNodes) {
                  // No explicit selection, add to the root
                  return {
                    ...node,
                    selectionSet: {
                      ...node.selectionSet,
                      selections: [
                        ...node.selectionSet.selections,
                        newFragmentSelection,
                      ],
                    },
                  };
                }

                return node;
              },
              OperationDefinition(op): OperationDefinitionNode {
                if (!selectedNodeOrNodes) {
                  // No explicit selection, add to the root
                  return {
                    ...op,
                    selectionSet: {
                      ...op.selectionSet,
                      selections: [
                        ...op.selectionSet.selections,
                        newFragmentSelection,
                      ],
                    },
                  };
                }

                return op;
              },
              SelectionSet(node) {
                if (!selectedNodeOrNodes) {
                  return;
                }

                const { loc } = node;

                if (!loc) {
                  return;
                }

                if (
                  loc.start === targetLoc.start &&
                  loc.end === targetLoc.end
                ) {
                  return {
                    ...node,
                    selections: [
                      ...node.selections.reduce(
                        (acc: SelectionNode[], curr) => {
                          const thisNodeIsSelectedNode = Array.isArray(
                            selectedNodeOrNodes
                          )
                            ? selectedNodeOrNodes.some(
                                (s) =>
                                  s.loc &&
                                  curr.loc &&
                                  s.loc.start === curr.loc.start &&
                                  s.loc.end === curr.loc.end
                              )
                            : curr.loc?.start ===
                                selectedNodeOrNodes.loc?.start &&
                              curr.loc?.end === selectedNodeOrNodes.loc?.end;

                          if (
                            thisNodeIsSelectedNode &&
                            !acc.includes(newFragmentSelection)
                          ) {
                            acc.push(newFragmentSelection);
                          }

                          if (shouldRemoveSelection && thisNodeIsSelectedNode) {
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

        const newFilePath = getNewFilePath(newComponentName);

        const moduleName = `${pascalCase(variableName)}Fragment`;
        const propName = uncapitalize(variableName);

        const newFragment = await makeFragment(
          fragmentName,
          typeInfo.parentTypeName,
          Array.isArray(selectedNodeOrNodes)
            ? selectedNodeOrNodes
            : [makeFieldSelection("__typename")]
        );

        fs.writeFileSync(
          newFilePath.fsPath,
          getFragmentComponentText({
            fragmentText: newFragment,
            moduleName,
            propName,
          })
        );

        const newDoc = await workspace.openTextDocument(newFilePath);
        await newDoc.save();

        openFileAndShowMessage({
          doc: newDoc,
          shouldOpenFile,
          newComponentName,
        });

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

        if (copyToClipboard) {
          copyComponentCodeToClipboard(
            makeNewFragmentComponentJsx({
              newComponentName,
              propName,
              variableName,
            })
          );
        }

        await editor.document.save();
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.add-new-fragment-component-to-value",
      async (
        uri: Uri,
        _doc: string,
        _selection: Range | Selection,
        tag: GraphQLSourceFromTag,
        type: GraphQLCompositeType,
        recordName: string,
        selectedVariableName: string,
        graphqlType: GraphQLType
      ) => {
        const editor = window.activeTextEditor;

        if (!editor) {
          return;
        }

        const newFragmentProps = await fragmentCreationWizard({
          uri,
          selectedVariableName,
          type,
          source: FragmentCreationSource.Value,
        });

        if (newFragmentProps == null) {
          return;
        }

        const {
          copyToClipboard,
          fragmentName,
          shouldOpenFile,
          newComponentName,
          variableName,
        } = newFragmentProps;

        const source = new Source(tag.content);
        const operationAst = parse(source);

        const newOp = addFragmentSpreadAtPosition(
          operationAst,
          recordName,
          type,
          fragmentName,
          graphqlType
        );

        if (newOp == null) {
          window.showWarningMessage("Could not add fragment.");
          return;
        }

        const updatedOperation = prettify(print(newOp));

        const newFilePath = getNewFilePath(newComponentName);

        const moduleName = `${pascalCase(variableName)}Fragment`;
        const propName = uncapitalize(variableName);

        const newFragment = await makeFragment(fragmentName, type.name, [
          makeFieldSelection("__typename"),
        ]);

        fs.writeFileSync(
          newFilePath.fsPath,
          getFragmentComponentText({
            fragmentText: newFragment,
            moduleName,
            propName,
          })
        );

        const newDoc = await workspace.openTextDocument(newFilePath);
        await newDoc.save();

        openFileAndShowMessage({
          doc: newDoc,
          shouldOpenFile,
          newComponentName,
        });

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
              new Position(tag.start.line, tag.start.character),
              new Position(tag.end.line, tag.end.character)
            ),
            restoreOperationPadding(updatedOperation, tag.content)
          );
        });

        await editor.document.save();

        if (copyToClipboard) {
          copyComponentCodeToClipboard(
            makeNewFragmentComponentJsx({
              newComponentName,
              variableName,
              propName,
            })
          );
        }
      }
    ),
    commands.registerCommand("vscode-rescript-relay.add-fragment", () =>
      addGraphQLComponent("Fragment")
    ),
    commands.registerCommand(
      "vscode-rescript-relay.add-file-with-fragment",
      async () => {
        const editor = window.activeTextEditor;

        if (!editor) {
          return;
        }

        const newFragmentProps = await fragmentCreationWizard({
          selectedVariableName: "",
          source: FragmentCreationSource.NewFile,
          type: null!,
          uri: editor.document.uri,
        });

        if (newFragmentProps == null) {
          return;
        }

        const {
          fragmentName,
          newComponentName,
          variableName,
          type,
          shouldOpenFile,
          copyToClipboard,
        } = newFragmentProps;

        const moduleName = `${pascalCase(variableName)}Fragment`;
        const propName = uncapitalize(variableName);

        const newFragment = await makeFragment(fragmentName, type.name, [
          makeFieldSelection("__typename"),
        ]);

        const newFilePath = getNewFilePath(newComponentName);

        fs.writeFileSync(
          newFilePath.fsPath,
          getFragmentComponentText({
            fragmentText: newFragment,
            moduleName,
            propName,
          })
        );

        const newDoc = await workspace.openTextDocument(newFilePath);
        await newDoc.save();

        openFileAndShowMessage({
          shouldOpenFile,
          doc: newDoc,
          newComponentName,
        });

        if (copyToClipboard) {
          copyComponentCodeToClipboard(
            makeNewFragmentComponentJsx({
              newComponentName,
              variableName,
              propName,
            })
          );
        }
      }
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
      "vscode-rescript-relay.open-graphql-schema",
      async (startLine: number, endLine: number) => {
        const relayConfig = await loadRelayConfig();

        if (relayConfig == null) {
          return;
        }

        const schemaTextDoc = await workspace.openTextDocument(
          relayConfig.schema
        );

        await window.showTextDocument(schemaTextDoc, {
          selection: new Range(
            new Position(startLine, 0),
            new Position(endLine, 0)
          ),
        });
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.open-generated-file-for-operation",
      async (opName: string) => {
        const relayConfig = await loadRelayConfig();

        if (relayConfig == null) {
          return;
        }

        const generatedFile = await workspace.openTextDocument(
          path.resolve(
            path.join(relayConfig.artifactDirectory, `${opName}_graphql.res`)
          )
        );

        await window.showTextDocument(generatedFile, {
          preserveFocus: true,
          viewColumn: ViewColumn.Beside,
        });
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.open-source-res-file-for-operation",
      async (opName: string) => {
        const fragment = await getFragmentDefinition(opName);

        if (fragment != null) {
          const doc = await workspace.openTextDocument(fragment.fileLocation);
          await window.showTextDocument(doc, {
            preserveFocus: true,
            viewColumn: ViewColumn.Beside,
          });
        } else {
          window.showWarningMessage(`Could not locate fragment '${opName}.`);
        }
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.goto-pos-in-doc",
      async (rawUri: string, line: number, char: number) => {
        const uri = Uri.parse(rawUri);

        await commands.executeCommand(
          "editor.action.goToLocations",
          uri,
          new Position(line, char),
          [],
          "goto"
        );
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.open-route-definitions",
      async (...routeArgs: Array<string>) => {
        const routes: Array<SingleRoute> = routeArgs.map((r) => {
          const [
            sourceFilePath,
            routeName,
            line,
            character,
            routeRendererFilePath,
          ] = r.split(";");

          return {
            sourceFilePath,
            routeName,
            loc: {
              line: parseInt(line, 10),
              character: parseInt(character, 10),
            },
            routeRendererFilePath,
          };
        });

        if (routes.length === 0) return;

        let targetRouteName: string | undefined;

        if (routes.length > 1) {
          targetRouteName = await window.showQuickPick(
            routes.map((r) => r.routeName),
            {
              title: "Choose what route to view",
            }
          );
        } else {
          targetRouteName = routes[0].routeName;
        }

        if (targetRouteName == null) return;

        const targetRoute = routes.find((r) => r.routeName === targetRouteName);

        if (targetRoute == null) return;

        const textDoc = await workspace.openTextDocument(
          targetRoute.sourceFilePath
        );

        await window.showTextDocument(textDoc, {
          selection: new Range(
            new Position(targetRoute.loc.line, targetRoute.loc.character),
            new Position(targetRoute.loc.line, targetRoute.loc.character)
          ),
        });
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.router-use-query-params",
      async () => {
        const currentDoc = window.activeTextEditor;
        if (currentDoc == null) return;
        if (path.extname(currentDoc.document.fileName) !== ".res") return;
        if (routerLspClient == null) return;

        const routes = await routerLspRoutesForFile(
          routerLspClient,
          currentDoc.document.fileName
        );

        if (routes.length === 0) return;

        let targetRouteName: string | undefined;

        if (routes.length > 1) {
          targetRouteName = await window.showQuickPick(
            routes.map((r) => r.routeName),
            {
              title: "Choose what route to add useQueryParams for",
            }
          );
        } else {
          targetRouteName = routes[0].routeName;
        }

        if (targetRouteName == null) return;

        const targetRoute = routes.find((r) => r.routeName === targetRouteName);

        if (targetRoute == null) return;

        currentDoc.edit((b) => {
          b.insert(
            currentDoc.selection.start,
            `let {queryParams} = Routes.${targetRoute.routeName
              .split("__")
              .join(".")}.Route.useQueryParams()`
          );
        });
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.router-match-url",
      async () => {
        if (routerLspClient == null) return;

        const url = await window.showInputBox({
          title: "URL",
          prompt: "Insert the URL you want to look up.",
          value: lastMatchedUrl,
        });

        if (url == null) return;

        const routes = await routerLspMatchUrl(routerLspClient, url);

        if (routes.length === 0) {
          window.showInformationMessage("No matching routes found.");
          return;
        }

        lastMatchedUrl = url;

        const pickedRoute = await window.showQuickPick(
          routes.flatMap((r, i) => {
            const spacing = Array.from({ length: i * 4 })
              .map((_) => " ")
              .join("");
            return [
              `${spacing}${r.routeName} - route definition`,
              `${spacing}${r.routeName} - route renderer`,
            ];
          })
        );

        if (pickedRoute == null) return;

        const [routeName, thingToOpen] = pickedRoute.trim().split(" - ");
        const targetRoute = routes.find((r) => r.routeName === routeName);

        if (targetRoute == null) return null;

        if (thingToOpen === "route definition") {
          await openPosInDoc(
            targetRoute.sourceFilePath,
            targetRoute.loc.line,
            targetRoute.loc.character
          );
        } else if (thingToOpen === "route renderer") {
          await openPosInDoc(targetRoute.routeRendererFilePath, 0, 0);
        }
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.open-pos-in-doc",
      async (rawUri: string, startLine: string, startChar: string) => {
        await openPosInDoc(
          rawUri,
          parseInt(startLine, 10),
          parseInt(startChar, 10)
        );
      }
    ),
    commands.registerCommand(
      "vscode-rescript-relay.replace-current-dot-completion",
      async (createInsertText: (symbol: string) => string) => {
        const editor = window.activeTextEditor!;

        // This tries to get the range for the symbol that triggered the autocomplete
        const currentNameRange = editor.document.getWordRangeAtPosition(
          new Position(
            editor.selection.start.line,
            editor.selection.start.character - 2
          )
        );

        if (currentNameRange != null) {
          const symbol = editor.document.getText(currentNameRange);
          // Replace the symbol and the . that triggered the completion
          const success = await editor.edit((edit) => {
            edit.replace(
              new Range(
                currentNameRange.start,
                new Position(
                  currentNameRange.end.line,
                  currentNameRange.end.character + 1
                )
              ),
              createInsertText(symbol)
            );
          });

          if (success) {
            editor.selection = new Selection(
              currentNameRange.start,
              currentNameRange.start
            );
          }
        }
      }
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
    ),
    commands.registerCommand(
      "vscode-rescript-relay.add-lazy-variant-of-component",
      async () => {
        const editor = window.activeTextEditor;

        if (!editor) {
          return;
        }

        const componentName = path.basename(editor.document.uri.path, ".res");

        const lazyComponentName = `${componentName}Lazy`;

        const newFilePath = getNewFilePath(lazyComponentName);

        fs.writeFileSync(
          newFilePath.fsPath,
          `include %relay.lazyComponent(${componentName}.make)`
        );

        const newDoc = await workspace.openTextDocument(newFilePath);
        await newDoc.save();

        window
          .showInformationMessage(
            `Lazy version of '${componentName}' added as '${lazyComponentName}.res'.`,
            "Open file"
          )
          .then((m) => {
            if (m) {
              window.showTextDocument(newDoc);
            }
          });
      }
    )
  );
}

async function initLanguageServer(
  context: ExtensionContext,
  outputChannel: OutputChannel
): Promise<{
  client: LanguageClient;
  disposableClient: Disposable;
  lspType: "relay" | "graphiql";
}> {
  const currentWorkspacePath = getCurrentWorkspaceRoot();

  if (!currentWorkspacePath) {
    throw new Error("Not inside a workspace.");
  }

  const config = await loadGraphQLConfig();

  if (!config) {
    throw new Error(
      "Could not init language server, did not find Relay config."
    );
  }

  const shouldCheckNativeRelayLsp = Boolean(
    workspace.getConfiguration("rescript-relay").get("useNativeRelayLsp")
  );

  const supportsNativeRelayLsp = (() => {
    if (!shouldCheckNativeRelayLsp) {
      return false;
    }
    try {
      // This checks if the current project supports running the Relay LSP.
      const res = cp.spawnSync(
        "npx",
        ["rescript-relay-compiler", "lsp", "--help"],
        {
          cwd: config.dirpath,
        }
      );

      const commandOutput = res.output
        .map((l) => (l != null ? l.toString() : ""))
        .join("");

      return commandOutput.includes("Run the language server. Used by IDEs.");
    } catch {
      return false;
    }
  })();

  if (supportsNativeRelayLsp) {
    let serverOptions: ServerOptions = {
      command: "npx",
      args: ["rescript-relay-compiler", "lsp"],
      options: {
        cwd: config.dirpath,
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
    };

    const client = new LanguageClient(
      "vscode-rescript-relay",
      "ReScriptRelay GraphQL Language Server",
      serverOptions,
      clientOptions
    );

    const disposableClient = client.start();
    context.subscriptions.push(disposableClient);

    return { client, disposableClient, lspType: "relay" };
  } else {
    const serverModule = context.asAbsolutePath(
      path.join("build", "server.js")
    );

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
                !dia.message.includes('on directive "@argumentDefinitions"') &&
                !dia.message.includes("__id")
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

    return { client, disposableClient, lspType: "graphiql" };
  }
}

async function initRouterLanguageServer(
  context: ExtensionContext,
  outputChannel: OutputChannel
): Promise<null | {
  client: LanguageClient;
  disposableClient: Disposable;
}> {
  const currentWorkspacePath = getCurrentWorkspaceRoot();

  if (!currentWorkspacePath) {
    throw new Error("Not inside a workspace.");
  }

  const config = await loadGraphQLConfig();

  if (!config) {
    throw new Error(
      "Could not init language server, did not find Relay config."
    );
  }

  const allowUsingEditorToolingForRouter = Boolean(
    workspace
      .getConfiguration("rescript-relay")
      .get("enableRescriptRelayRouterLsp")
  );

  const supportsRouterLsp = (() => {
    if (!allowUsingEditorToolingForRouter) {
      return false;
    }

    try {
      // This checks if the current project supports running the router LSP.
      const res = cp.spawnSync("npx", ["rescript-relay-router", "-help"], {
        cwd: config.dirpath,
      });

      if (res.error != null) {
        throw res.error;
      }

      const commandOutput = res.output
        ?.map((l) => (l != null ? l.toString() : ""))
        .join("");

      return commandOutput.includes("Starts a language server for the router.");
    } catch (e) {
      return false;
    }
  })();

  if (supportsRouterLsp) {
    let serverOptions: ServerOptions = {
      command: "npx",
      args: ["rescript-relay-router", "lsp", "-stdio"],
      options: {
        cwd: config.dirpath,
      },
    };

    let clientOptions: LanguageClientOptions = {
      documentSelector: [
        { pattern: "**/*Routes.json", language: "rescriptRelayRouter" },
        { pattern: "**/routes.json", language: "rescriptRelayRouter" },
        { pattern: "**/*.res", language: "rescript" },
      ],
      synchronize: {
        fileEvents: workspace.createFileSystemWatcher(
          "**/rescriptRelayRouterConfig.{js,cjs}"
        ),
      },
      outputChannel: outputChannel,
      outputChannelName: "RescriptRelayRouter Language Server",
      revealOutputChannelOn: RevealOutputChannelOn.Never,
    };

    const client = new LanguageClient(
      "vscode-rescript-relay-router",
      "RescriptRelayRouter Language Server",
      serverOptions,
      clientOptions
    );

    const disposableClient = client.start();
    context.subscriptions.push(disposableClient);

    return { client, disposableClient };
  } else {
    outputChannel.appendLine("Could not start router LSP.");
  }

  return null;
}

export async function activate(context: ExtensionContext) {
  const projectType = await isReScriptRelayProject();

  if (!projectType) {
    window.showErrorMessage("not rescript relay project");
    return;
  }

  let relayLspOutputChannel: OutputChannel = window.createOutputChannel(
    "RescriptRelay GraphQL Language Server"
  );

  let routerLspOutputChannel: OutputChannel = window.createOutputChannel(
    "RescriptRelayRouter Language Server"
  );

  let client: LanguageClient | undefined;
  let routerLspClient: LanguageClient | undefined;
  let clientDisposable: Disposable | undefined;
  let routerLspClientDisposable: Disposable | undefined;
  let lspType: "relay" | "graphiql" | undefined;

  const relayConfig = await loadRelayConfig();
  const graphqlConfig = await loadGraphQLConfig();

  async function initClient() {
    if (client) {
      await client.stop();
    }

    if (routerLspClient) {
      await routerLspClient.stop();
    }

    if (clientDisposable) {
      clientDisposable.dispose();
    }

    if (routerLspClientDisposable) {
      routerLspClientDisposable.dispose();
    }

    const inited = await initLanguageServer(context, relayLspOutputChannel);
    client = inited.client;
    clientDisposable = inited.disposableClient;
    lspType = inited.lspType;

    const routerLsp = await initRouterLanguageServer(
      context,
      routerLspOutputChannel
    );
    routerLspClient = routerLsp?.client;
    routerLspClientDisposable = routerLsp?.disposableClient;
  }

  await initClient();
  initCommands(context, routerLspClient);
  initProviders(context);

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

              // The native Relay LSP watches schema changes by itself.
              if (lspType === "graphiql") {
                await initClient();
              }
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
    function checkThatWatchmanIsInstalled() {
      const client = new watchman.Client();
      client.capabilityCheck({ optional: [], required: [] }, () => {});
      const installText = "Open install instructions";
      client.on("error", () =>
        window
          .showWarningMessage(
            "You're missing watchman. Please install watchman to ensure things in this extension work as expected.",
            installText
          )
          .then((item) => {
            if (item === installText) {
              env.openExternal(
                Uri.parse(
                  "https://facebook.github.io/watchman/docs/install.html"
                )
              );
            }
          })
      );
    }

    checkThatWatchmanIsInstalled();

    if (lspType === "graphiql") {
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
          }
        );
      });
    }
  }
}

export function deactivate() {
  console.log('Extension "vscode-rescript-relay" is now de-activated!');
}
