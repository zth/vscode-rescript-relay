import {
  runHoverCommand,
  runTypeDefinitionCommand,
} from "./ReScriptEditorSupport";
import {
  extensions,
  TextDocument,
  Range,
  Selection,
  Position,
  window,
  Uri,
} from "vscode";
import {
  HoverParams,
  TypeDefinitionParams,
} from "vscode-languageserver-protocol";
import { extractContextFromHover, GqlCtx } from "./contextUtilsNoVscode";
import * as path from "path";
import * as fs from "fs";
import { extractGraphQLSources } from "./findGraphQLSources";
import { GraphQLSourceFromTag } from "./extensionTypes";

const logDebug = (txt: string) => {
  return;
  window.showInformationMessage(txt);
};

function getHoverCtx(
  selection: Range | Selection | Position,
  document: TextDocument,
  extensionPath: string
) {
  const position = selection instanceof Position ? selection : selection.start;
  const propNameRange = document.getWordRangeAtPosition(position);

  if (propNameRange == null) {
    return null;
  }

  const propName = document.getText(propNameRange);

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

  return extractContextFromHover(propName, res);
}

export function extractContextFromTypeDefinition(
  selection: Position,
  document: TextDocument,
  uri: string,
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  }
): GqlCtx | null {
  /**
   * - Parse out current identifier (some regexp grabbing the last word until .)
   * - Combine with the name of the file itself
   */
  const fileName = path.basename(uri);

  if (fileName.endsWith("_graphql.res")) {
    const fragmentName = fileName.slice(
      0,
      fileName.length - "_graphql.res".length
    );

    const propNameRange = document.getWordRangeAtPosition(selection);

    if (propNameRange == null) {
      return null;
    }

    const propName = document.getText(propNameRange);

    const file = fs.readFileSync(Uri.parse(uri).fsPath, "utf-8");

    const targetContent = file
      .split("\n")
      .slice(range.start.line, range.end.line)
      .join("\n");

    const recordName = targetContent.split(/(type |and )/g)[2].split(" =")[0];

    return {
      fragmentName,
      recordName: `${recordName}_${propName}`,
      propName,
    };
  }

  return null;
}

function getTypeDefCtx(
  selection: Range | Selection | Position,
  document: TextDocument,
  extensionPath: string
) {
  const position = selection instanceof Position ? selection : selection.start;

  const params: TypeDefinitionParams = {
    position,
    textDocument: {
      uri: document.uri.toString(),
    },
  };

  let uri: string | null = null;
  let range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  } | null = null;

  try {
    const res = runTypeDefinitionCommand(
      {
        jsonrpc: "2.0",
        id: Math.random(),
        method: "textDocument/typeDefinition",
        params,
      },
      extensionPath
      // @ts-ignore
    ).result as null | {
      uri: string;
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
    };

    if (res != null) {
      uri = res.uri;
      range = res.range;
    }
  } catch {
    logDebug(`Bailing because analysis command failed`);
    return null;
  }

  if (uri == null || range == null) {
    logDebug("uri or range was null");
    return null;
  }

  return extractContextFromTypeDefinition(position, document, uri, range);
}

export function findContext(
  document: TextDocument,
  selection: Range | Selection | Position
): {
  recordName: string;
  fragmentName: string;
  sourceFilePath: string;
  tag: GraphQLSourceFromTag;
  propName: string;
} | null {
  const extensionPath = extensions.getExtension("chenglou92.rescript-vscode")
    ?.extensionPath;

  if (!extensionPath) {
    logDebug(`Bailing because no extension path`);
    return null;
  }

  let ctx: GqlCtx | null = getHoverCtx(selection, document, extensionPath);

  if (ctx == null) {
    ctx = getTypeDefCtx(selection, document, extensionPath);
  }

  if (ctx == null) {
    logDebug("Got no typedef");
    return null;
  }

  // Ok, we have the fragment name and type name. Let's look up the source for
  // it, and actual GraphQL document.

  let sourceFilePath: string | null = null;
  const theCtx = ctx;

  if (
    theCtx.fragmentName.startsWith(path.basename(document.uri.fsPath, ".res"))
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
      t.type === "TAG" && t.content.includes(`fragment ${theCtx.fragmentName}`)
  );

  if (tag == null || tag.type !== "TAG") {
    logDebug(`Bailing because no tag`);
    return null;
  }

  return {
    sourceFilePath,
    tag,
    ...theCtx,
  };
}
