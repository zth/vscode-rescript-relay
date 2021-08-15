import { InsertGraphQLComponentType } from "./extensionTypes";
import { capitalize, uncapitalize } from "./extensionUtils";
import { loadFullSchema } from "./loadSchema";

import { TextEditorEdit, window, Selection } from "vscode";

import {
  GraphQLSchema,
  isInterfaceType,
  isObjectType,
  VariableDefinitionNode,
  ArgumentNode,
} from "graphql";
import {
  makeFragment,
  makeOperation,
  pickTypeForFragment,
} from "./graphqlUtils";
import { getPreferredFragmentPropName } from "./utils";
import { pascalCase } from "pascal-case";
import {
  makeFieldSelection,
  makeVariableDefinitionNode,
} from "./graphqlUtilsNoVscode";

async function getValidModuleName(
  docText: string,
  name: string
): Promise<string> {
  const newName = docText.includes(`module ${name} =`)
    ? await window.showInputBox({
        prompt: "Enter module name ('" + name + "' already exists in document)",
        validateInput: (v: string) =>
          v !== name ? null : "Name cannot be '" + name + "'.",
        value: name,
      })
    : null;

  return newName || name;
}

interface QuickPickFromSchemaResult {
  schemaPromise: Promise<GraphQLSchema | undefined>;
  result: Thenable<string | undefined>;
}

export function quickPickFromSchema(
  placeHolder: string | undefined,
  getItems: (schema: GraphQLSchema) => string[]
): QuickPickFromSchemaResult {
  const schemaPromise = loadFullSchema();

  return {
    schemaPromise,
    result: window.showQuickPick(
      schemaPromise.then((maybeSchema: GraphQLSchema | undefined) => {
        if (maybeSchema) {
          return getItems(maybeSchema);
        }

        return [];
      }),
      {
        placeHolder,
      }
    ),
  };
}

export async function addGraphQLComponent(type: InsertGraphQLComponentType) {
  const textEditor = window.activeTextEditor;

  if (!textEditor) {
    window.showErrorMessage("Missing active text editor.");
    return;
  }

  const docText = textEditor.document.getText();

  let insert = "";

  // TODO: Fix this, this is insane
  const moduleName = capitalize(
    (textEditor.document.fileName.split(/\\|\//).pop() || "")
      .split(".")
      .shift() || ""
  );

  switch (type) {
    case "Fragment": {
      const onType = await pickTypeForFragment();

      if (!onType) {
        return;
      }

      const rModuleName = getPreferredFragmentPropName(onType);
      const fragmentName = `${capitalize(moduleName)}_${uncapitalize(
        rModuleName
      )}`;
      const targetModuleName = `${pascalCase(rModuleName)}Fragment`;
      const propName = uncapitalize(rModuleName);

      insert += `module ${targetModuleName} = %relay(\`\n  ${await makeFragment(
        fragmentName,
        onType
      )}\n\`\n)`;

      const shouldInsertComponentBoilerplate =
        (await window.showQuickPick(["Yes", "No"], {
          placeHolder: "Do you also want to add boilerplate for a component?",
        })) === "Yes";

      if (shouldInsertComponentBoilerplate) {
        insert += `\n\n
@react.component
let make = (~${propName}) => {
  let ${propName} = ${targetModuleName}.use(${propName})

  React.null
}`;
      }
      break;
    }
    case "Query": {
      const { schemaPromise, result } = quickPickFromSchema(
        "Select root field",
        (s) => {
          const queryObj = s.getQueryType();
          if (queryObj) {
            return Object.keys(queryObj.getFields()).filter(
              (k) => !k.startsWith("__")
            );
          }

          return [];
        }
      );

      const query = await result;

      if (!query) {
        return;
      }

      const queryField = await schemaPromise.then((schema) => {
        if (schema) {
          const queryObj = schema.getQueryType();
          if (queryObj) {
            return queryObj.getFields()[query] || null;
          }
        }

        return null;
      });

      if (!queryField) {
        return;
      }

      let onType: string | undefined;

      if (queryField.name === "node" && isInterfaceType(queryField.type)) {
        const schema = await schemaPromise;
        if (schema) {
          const possibleTypes = schema.getPossibleTypes(queryField.type);
          onType = await window.showQuickPick(
            possibleTypes.map((pt) => pt.name),
            {
              placeHolder:
                "What type do you want to use on the node interface?",
            }
          );
        }
      }

      const rModuleName = await getValidModuleName(docText, `Query`);

      insert += `module ${rModuleName} = %relay(\`\n  ${await makeOperation({
        operationType: "query",
        operationName: `${moduleName}${rModuleName}${
          rModuleName.endsWith("Query") ? "" : "Query"
        }`,
        rootField: queryField,
        onType,
      })}\n\`)`;

      const shouldInsertComponentBoilerplate =
        (await window.showQuickPick(["Yes", "No"], {
          placeHolder: "Do you also want to add boilerplate for a component?",
        })) === "Yes";

      if (shouldInsertComponentBoilerplate) {
        const typeOfQuery = await window.showQuickPick(["Preloaded", "Lazy"], {
          placeHolder: "What type of query are you making?",
        });

        insert += `\n\n
@react.component
let make = (${typeOfQuery === "Preloaded" ? "~queryRef" : ""}) => {
  ${
    typeOfQuery === "Preloaded"
      ? `let data = ${rModuleName}.usePreloaded(~queryRef, ())`
      : `let data = ${rModuleName}.use(~variables=(), ())`
  }

  React.null
}`;
      }
      break;
    }
    case "Mutation": {
      const { schemaPromise, result } = quickPickFromSchema(
        "Select mutation",
        (s) => {
          const mutationObj = s.getMutationType();
          if (mutationObj) {
            return Object.keys(mutationObj.getFields()).filter(
              (k) => !k.startsWith("__")
            );
          }

          return [];
        }
      );

      const mutation = await result;

      if (!mutation) {
        return;
      }

      const mutationField = await schemaPromise.then((schema) => {
        if (schema) {
          const mutationObj = schema.getMutationType();
          if (mutationObj) {
            return mutationObj.getFields()[mutation] || null;
          }
        }

        return null;
      });

      if (!mutationField) {
        return;
      }

      let mutationSubFieldConfig:
        | {
            fieldName: string;
            args: {
              name: string;
              type: string;
            }[];
          }
        | undefined;

      if (isObjectType(mutationField.type)) {
        window.showInformationMessage(
          JSON.stringify({ name: mutationField.type.name })
        );

        const fields = mutationField.type.getFields();
        const fieldNames = Object.keys(fields);
        const field =
          fieldNames.length === 1
            ? fieldNames[0]
            : await window.showQuickPick(fieldNames, {
                placeHolder:
                  "Select the field you want to target on your mutation",
              });

        if (field) {
          const theField = fields[field];
          const args = mutationField.args.filter((arg) =>
            arg.type.toString().endsWith("!")
          );

          mutationSubFieldConfig = {
            fieldName: theField.name,
            args: args.map((arg) => ({
              name: arg.name,
              type: arg.type.toString(),
            })),
          };
        }
      }

      const rModuleName = await getValidModuleName(
        docText,
        `${capitalize(mutation)}Mutation`
      );

      window.showInformationMessage(JSON.stringify(mutationSubFieldConfig));

      insert += `module ${rModuleName} = %relay(\`\n  ${await makeOperation({
        operationType: "mutation",
        operationName: `${moduleName}_${capitalize(mutation)}Mutation`,
        rootField: mutationField,
        skipAddingFieldSelections: !!mutationSubFieldConfig,
        creator: mutationSubFieldConfig
          ? (node) => {
              if (!mutationSubFieldConfig) {
                return node;
              }

              return {
                ...node,
                variableDefinitions: mutationSubFieldConfig.args.reduce(
                  (acc: VariableDefinitionNode[], curr) => {
                    const varNode = makeVariableDefinitionNode(
                      curr.name,
                      curr.type
                    );

                    if (varNode) {
                      acc.push(varNode);
                    }
                    return acc;
                  },
                  []
                ),
                selectionSet: {
                  kind: "SelectionSet",
                  selections: [
                    {
                      kind: "Field",
                      arguments: mutationSubFieldConfig.args.map(
                        (arg): ArgumentNode => ({
                          kind: "Argument",
                          value: {
                            kind: "Variable",
                            name: {
                              kind: "Name",
                              value: arg.name,
                            },
                          },
                          name: {
                            kind: "Name",
                            value: arg.name,
                          },
                        })
                      ),
                      name: {
                        kind: "Name",
                        value: mutationField.name,
                      },
                      selectionSet: {
                        kind: "SelectionSet",
                        selections: [
                          makeFieldSelection(mutationSubFieldConfig.fieldName),
                        ],
                      },
                    },
                  ],
                },
              };
            }
          : undefined,
      })}\n\`)`;

      const shouldInsertComponentBoilerplate =
        (await window.showQuickPick(["Yes", "No"], {
          placeHolder: "Do you also want to add boilerplate for a component?",
        })) === "Yes";

      if (shouldInsertComponentBoilerplate) {
        insert += `\n\n
@react.component
let make = () => {
  let (mutate, isMutating) = ${rModuleName}.use()

  React.null
}`;
      }
      break;
    }

    case "Subscription": {
      const { schemaPromise, result } = quickPickFromSchema(
        "Select subscription",
        (s) => {
          const subscriptionObj = s.getSubscriptionType();
          if (subscriptionObj) {
            return Object.keys(subscriptionObj.getFields()).filter(
              (k) => !k.startsWith("__")
            );
          }

          return [];
        }
      );

      const subscription = await result;

      if (!subscription) {
        return;
      }

      const subscriptionField = await schemaPromise.then((schema) => {
        if (schema) {
          const subscriptionObj = schema.getSubscriptionType();
          if (subscriptionObj) {
            return subscriptionObj.getFields()[subscription] || null;
          }
        }

        return null;
      });

      if (!subscriptionField) {
        return;
      }

      const rModuleName = await getValidModuleName(docText, `Subscription`);

      insert += `module ${rModuleName} = %relay(\`\n  ${await makeOperation({
        operationType: "subscription",
        operationName: `${moduleName}_${capitalize(subscription)}Subscription`,
        rootField: subscriptionField,
      })}\n\`)`;

      const shouldInsertComponentBoilerplate =
        (await window.showQuickPick(["Yes", "No"], {
          placeHolder: "Do you also want to add boilerplate for a component?",
        })) === "Yes";

      if (shouldInsertComponentBoilerplate) {
        insert += `\n\n
@react.component
let make = () => {
  let environment = RescriptRelay.useEnvironmentFromContext()

  React.useEffect0(() => {
    let subscription = ${rModuleName}.subscribe(
      ~environment,
      ~variables=(),
      (),
    )

    Some(() => RescriptRelay.Disposable.dispose(subscription))
  })

  React.null
}`;
      }
      break;
    }
  }

  await textEditor.edit((editBuilder: TextEditorEdit) => {
    const textDocument = textEditor.document;

    if (!textDocument) {
      return;
    }

    editBuilder.insert(textEditor.selection.active, insert);
  });

  const currentPos = textEditor.selection.active;
  const newPos = currentPos.with(currentPos.line - 3);

  textEditor.selection = new Selection(newPos, newPos);

  const textDocument = textEditor.document;

  if (!textDocument) {
    return;
  }

  await textDocument.save();

  let edited: boolean | undefined = false;

  if (edited) {
    await textDocument.save();
  }
}
