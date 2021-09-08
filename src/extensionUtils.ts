import * as prettier from "prettier/standalone";
import * as parserGraphql from "prettier/parser-graphql";
import {
  window,
  commands,
  Range,
  Selection,
  Position,
  CompletionItem,
} from "vscode";
import { GraphQLSourceFromTag } from "./extensionTypes";
import { getSourceLocOfGraphQL } from "./contextUtils";

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
