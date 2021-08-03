import { runHoverCommand } from "./ReScriptEditorSupport";
import {
  extensions,
  TextDocument,
  Range,
  Selection,
  Position,
  window,
} from "vscode";
import { HoverParams } from "vscode-languageserver-protocol";
import { extractContextFromHover } from "./contextUtilsNoVscode";
import * as path from "path";
import { extractGraphQLSources } from "./findGraphQLSources";
import { GraphQLSourceFromTag } from "./extensionTypes";

const logDebug = (txt: string) => {
  return;
  window.showInformationMessage(txt);
};

export function findContext(
  document: TextDocument,
  selection: Range | Selection | Position
): {
  recordName: string;
  fragmentName: string;
  sourceFilePath: string;
  tag: GraphQLSourceFromTag;
} | null {
  const extensionPath = extensions.getExtension("chenglou92.rescript-vscode")
    ?.extensionPath;

  if (!extensionPath) {
    logDebug(`Bailing because no extension path`);
    return null;
  }

  const params: HoverParams = {
    position: selection instanceof Position ? selection : selection.start,
    textDocument: {
      uri: document.uri.toString(),
    },
  };

  let res: string | null = null;

  try {
    res =
      runHoverCommand(
        {
          jsonrpc: "2.0",
          id: Math.random(),
          method: "hover",
          params,
        },
        extensionPath
        // @ts-ignore
      ).result?.contents ?? null;
  } catch {
    logDebug(`Bailing because analysis command failed`);
    return null;
  }

  if (res == null) {
    return null;
  }

  const ctxFromHover = extractContextFromHover(res);

  if (ctxFromHover == null) {
    logDebug(`Bailing because could not extract ctx from hover`);
    return null;
  }

  // Ok, we have the fragment name and type name. Let's look up the source for
  // it, and actual GraphQL document.

  let sourceFilePath: string | null = null;

  if (
    ctxFromHover.fragmentName.startsWith(
      path.basename(document.uri.fsPath, ".res")
    )
  ) {
    // This is from the same file we're in
    sourceFilePath = document.uri.fsPath;
  } else {
    // TODO: Support looking up from other files..
  }

  if (sourceFilePath == null) {
    logDebug(`Bailing because no source file path`);
    return null;
  }

  const tag = extractGraphQLSources("rescript", document.getText())?.find(
    (t) =>
      t.type === "TAG" &&
      t.content.includes(`fragment ${ctxFromHover.fragmentName}`)
  );

  if (tag == null || tag.type !== "TAG") {
    logDebug(`Bailing because no tag`);
    return null;
  }

  return {
    sourceFilePath,
    tag,
    ...ctxFromHover,
  };
}
