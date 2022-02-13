import * as prettier from "prettier/standalone";
import * as parserGraphql from "prettier/parser-graphql";
import {
  window,
  commands,
  Range,
  Selection,
  Position,
  CompletionItem,
  Uri,
  env,
  TextDocument,
  ViewColumn,
} from "vscode";
import { GraphQLSourceFromTag } from "./extensionTypes";
import { getSourceLocOfGraphQL } from "./contextUtils";
import * as path from "path";
import { validateRescriptVariableName } from "./extensionUtilsNoVscode";
import { getPreferredFragmentPropName } from "./utils";
import { GraphQLCompositeType, isCompositeType } from "graphql";
import { pickTypeForFragment } from "./graphqlUtils";
import { loadFullSchema } from "./loadSchema";

export const getNormalizedSelection = (
  range: Range,
  selectedOp: GraphQLSourceFromTag
): [Position, Position] => {
  const start = new Position(
    range.start.line - selectedOp.start.line + 1,
    range.start.character
  );

  const end = new Position(
    range.end.line - selectedOp.start.line + 1,
    range.end.character
  );

  if (start.isBeforeOrEqual(end)) {
    return [start, end];
  }

  return [end, start];
};

export function prettify(str: string): string {
  return (
    prettier
      .format(str, {
        parser: "graphql",
        plugins: [parserGraphql],
      })
      /**
       * Prettier adds a new line to the output by design.
       * This circumvents that as it messes things up.
       */
      .replace(/^\s+|\s+$/g, "")
  );
}

export const padOperation = (operation: string, indentation: number): string =>
  operation
    .split("\n")
    .map((s: string) => " ".repeat(indentation) + s)
    .join("\n");

const initialWhitespaceRegexp = new RegExp(/^[\s]*(?=[\w])/g);
const endingWhitespaceRegexp = new RegExp(/[\s]*$/g);

export const findOperationPadding = (operation: string): number => {
  const initialWhitespace = (
    operation.match(initialWhitespaceRegexp) || []
  ).pop();
  const firstRelevantLine = (initialWhitespace || "").split("\n").pop();

  return firstRelevantLine ? firstRelevantLine.length : 0;
};

export const restoreOperationPadding = (
  operation: string,
  initialOperation: string
): string => {
  const endingWhitespace = (
    initialOperation.match(endingWhitespaceRegexp) || []
  ).join("");

  return (
    "\n" +
    padOperation(operation, findOperationPadding(initialOperation)) +
    endingWhitespace
  );
};

export function capitalize(str: string): string {
  return str.slice(0, 1).toUpperCase() + str.slice(1);
}

export function uncapitalize(str: string): string {
  return str.slice(0, 1).toLowerCase() + str.slice(1);
}

export function waitFor(time: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

export async function wrapInJsx(
  start: string,
  end: string,
  endSelectionOffset: number
) {
  const textEditor = window.activeTextEditor;

  if (textEditor) {
    const [currentSelection] = textEditor.selections;
    const hasSelectedRange = !currentSelection.start.isEqual(
      currentSelection.end
    );

    if (!hasSelectedRange) {
      await commands.executeCommand("editor.emmet.action.balanceOut");
    }

    const [first] = textEditor.selections;

    if (!first.start.isEqual(first.end)) {
      const selectedRange = new Range(first.start, first.end);
      const text = textEditor.document.getText(selectedRange);

      await textEditor.edit((editBuilder) => {
        editBuilder.replace(selectedRange, `${start}${text}${end}`);
      });

      const endPos = first.start.with(
        undefined,
        first.start.character + endSelectionOffset
      );

      const endSelection = new Selection(endPos, endPos);

      textEditor.selections = [endSelection];
    }
  }
}

export const createCompletionItemsForFragmentSpreads = (
  label: string,
  spreads: string[]
) => {
  const items: CompletionItem[] = [];

  spreads.forEach((spread) => {
    const item = new CompletionItem(`${label}: ${spread}`);
    item.sortText = `zz ${label} ${spread}`;
    item.detail = `Component for \`${spread}\``;

    // @ts-ignore
    item.__extra = {
      label: label,
      fragmentName: spread,
    };

    items.push(item);
  });

  return items;
};

export const fillInFileDataForFragmentSpreadCompletionItems = async (
  items: CompletionItem[],
  viaCommand = false
) => {
  const processedItems: (CompletionItem | null)[] = await Promise.all(
    items.map(async (item) => {
      const extra: { label: string; fragmentName: string } = (item as any)
        .__extra;

      const sourceLoc = await getSourceLocOfGraphQL(extra.fragmentName);

      if (sourceLoc == null) {
        return null;
      }

      // Infer propname
      const propName = extra.fragmentName.split("_").pop() ?? extra.label;

      if (viaCommand) {
        item.insertText = "";
        item.command = {
          command: "vscode-rescript-relay.replace-current-dot-completion",
          title: "",
          arguments: [
            (symbol: string) =>
              `<${sourceLoc.componentName} ${propName}={${symbol}.fragmentRefs} />`,
          ],
        };
      } else {
        item.insertText = `<${sourceLoc.componentName} ${propName}={${extra.label}.fragmentRefs} />`;
      }

      return item;
    })
  );

  return processedItems.length > 0
    ? (processedItems.filter(Boolean) as CompletionItem[])
    : null;
};

export function getModuleNameFromFile(uri: Uri): string {
  return capitalize(path.basename(uri.path, ".res"));
}

export enum FragmentCreationSource {
  GraphQLTag,
  Value,
  NewFile,
  CodegenInFile,
}

type FragmentCreationWizardConfig = {
  uri: Uri;
  selectedVariableName: string;
  type: GraphQLCompositeType;
  source: FragmentCreationSource;
};

export async function fragmentCreationWizard({
  uri,
  selectedVariableName,
  type,
  source,
}: FragmentCreationWizardConfig) {
  let newComponentName = "";

  if (source === FragmentCreationSource.CodegenInFile) {
    newComponentName = getModuleNameFromFile(uri);
  } else {
    newComponentName = (await window.showInputBox({
      prompt: "Name of your new component",
      value: getModuleNameFromFile(uri),
      validateInput(v: string): string | null {
        return /^[a-zA-Z0-9_]*$/.test(v)
          ? null
          : "Please only use alphanumeric characters and underscores.";
      },
    })) as string;

    if (!newComponentName) {
      window.showWarningMessage("Your component must have a name.");
      return null;
    }
  }

  let typ = type;

  if (
    source === FragmentCreationSource.NewFile ||
    source === FragmentCreationSource.CodegenInFile
  ) {
    const typeName = await pickTypeForFragment();
    const schema = await loadFullSchema();
    const theType = schema?.getType(typeName ?? "");

    if (theType != null && isCompositeType(theType)) {
      typ = theType;
    }
  }

  let theSelectedVariableName =
    selectedVariableName != null && selectedVariableName !== ""
      ? selectedVariableName
      : uncapitalize(getPreferredFragmentPropName(typ.name));

  const variableName =
    (await window.showInputBox({
      prompt: `What do you want to call the prop name for the fragment?`,
      value: theSelectedVariableName,
      validateInput: (input) => {
        if (input === "" || !validateRescriptVariableName(input)) {
          return "Invalid ReScript variable name";
        }
      },
    })) ?? uncapitalize(getPreferredFragmentPropName(typ.name));

  let copyToClipboard = false;
  let shouldOpenFile = "No";

  if (source !== FragmentCreationSource.CodegenInFile) {
    shouldOpenFile =
      (await window.showQuickPick(
        ["Yes, in the current editor", "Yes, to the right", "No"],
        {
          placeHolder: "Do you want to open the new file directly?",
        }
      )) ?? "No";

    copyToClipboard =
      (await window.showQuickPick(["Yes", "No"], {
        placeHolder:
          "Do you want to copy the JSX for using the new component to the clipboard?",
      })) === "Yes";
  }

  let shouldRemoveSelection = false;

  if (source === FragmentCreationSource.GraphQLTag) {
    shouldRemoveSelection =
      (await window.showQuickPick(["Yes", "No"], {
        placeHolder: "Do you want to remove the selection from this fragment?",
      })) === "Yes";
  }

  const fragmentName = `${capitalize(
    newComponentName.replace(/_/g, "")
  )}_${uncapitalize(variableName)}`;

  return {
    shouldOpenFile,
    fragmentName,
    copyToClipboard,
    newComponentName,
    variableName,
    shouldRemoveSelection,
    type: typ,
  };
}

export function copyComponentCodeToClipboard(text: string) {
  env.clipboard.writeText(text);
  window.showInformationMessage(
    `Code for your new component has been copied to the clipboard.`
  );
}

export function openFileAndShowMessage({
  shouldOpenFile,
  doc,
  newComponentName,
}: {
  shouldOpenFile: string;
  doc: TextDocument;
  newComponentName: string;
}) {
  const msg = `"${newComponentName}.res" was created with your new fragment.`;

  if (shouldOpenFile === "Yes, in the current editor") {
    window.showTextDocument(doc);
  } else if (shouldOpenFile === "Yes, to the right") {
    window.showTextDocument(doc, ViewColumn.Beside, true);
  } else if (shouldOpenFile === "No") {
    window.showInformationMessage(msg, "Open file").then((m) => {
      if (m) {
        window.showTextDocument(doc);
      }
    });
  }
}

export function makeNewFragmentComponentJsx({
  newComponentName,
  propName,
  variableName,
}: {
  newComponentName: string;
  propName: string;
  variableName: string;
}) {
  return `<${newComponentName} ${propName}=${variableName}.fragmentRefs />`;
}
