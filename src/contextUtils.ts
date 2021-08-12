import {
  runCompletionCommand,
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
  workspace,
} from "vscode";
import {
  CompletionParams,
  HoverParams,
  TextDocumentIdentifier,
  TypeDefinitionParams,
} from "vscode-languageserver-protocol";
import {
  extractContextFromHover,
  findGraphQLTypeFromRecord,
  GqlCtx,
} from "./contextUtilsNoVscode";
import * as path from "path";
import * as fs from "fs";
import { extractGraphQLSources } from "./findGraphQLSources";
import { GraphQLSourceFromTag } from "./extensionTypes";
import { loadRelayConfig } from "./loadSchema";
import * as lineReader from "line-reader";
import { GraphQLType } from "./contextUtilsNoVscode";

const logDebug = (txt: string) => {
  return;
  window.showInformationMessage(txt);
};

export const sourceLocExtractor = new RegExp(
  /(?<=\/\* @sourceLoc )[A-Za-z_.0-9]+(?= \*\/)/g
);

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
    const graphqlName = fileName.slice(
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
    const graphqlType = findGraphQLTypeFromRecord(recordName, graphqlName);

    return {
      graphqlName,
      graphqlType,
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

export function complete(document: TextDocument, selection: Position) {
  const extensionPath = extensions.getExtension("chenglou92.rescript-vscode")
    ?.extensionPath;

  if (!extensionPath) {
    logDebug(`Bailing because no extension path`);
    return null;
  }

  let r = null;

  try {
    const params: CompletionParams = {
      position: selection,
      textDocument: TextDocumentIdentifier.create(document.uri.toString()),
    };

    const res = runCompletionCommand(
      {
        jsonrpc: "2.0",
        id: Math.random(),
        method: "textDocument/completion",
        params,
      },
      document.getText(),
      extensionPath
      // @ts-ignore
    ).result as null | { label: string; detail: string }[];

    if (res != null) {
      r = res;
    }
  } catch (e) {
    logDebug(`Bailing because analysis command failed`);
    return null;
  }

  return r;
}

export async function findContext(
  document: TextDocument,
  selection: Range | Selection | Position,
  allowFilesOutsideOfCurrent = false
): Promise<{
  recordName: string;
  graphqlName: string;
  graphqlType: GraphQLType;
  sourceFilePath: string;
  tag: GraphQLSourceFromTag;
  propName: string;
} | null> {
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
  let docText = "";
  const theCtx = ctx;

  if (
    theCtx.graphqlName.startsWith(path.basename(document.uri.fsPath, ".res"))
  ) {
    // This is from the same file we're in
    sourceFilePath = document.uri.fsPath;
    docText = document.getText();
  } else if (allowFilesOutsideOfCurrent) {
    const sourceLoc = await getSourceLocOfGraphQL(theCtx.graphqlName);

    if (sourceLoc != null) {
      const [fileUri] = await workspace.findFiles(
        `**/${sourceLoc.fileName}`,
        null,
        1
      );

      if (fileUri != null) {
        sourceFilePath = fileUri.fsPath;
        docText = fs.readFileSync(sourceFilePath, "utf-8");
      }
    }
  }

  if (sourceFilePath == null) {
    logDebug(`Bailing because no source file path`);
    return null;
  }

  const tag = extractGraphQLSources("rescript", docText)?.find(
    (t) =>
      t.type === "TAG" &&
      t.content.includes(`${theCtx.graphqlType} ${theCtx.graphqlName}`)
  );

  if (tag == null || tag.type !== "TAG") {
    logDebug(`Bailing because no tag`);
    return null;
  }

  return {
    sourceFilePath,
    tag,
    graphqlName: theCtx.graphqlName,
    // @ts-ignore oh how I love you TS
    graphqlType: theCtx.graphqlType,
    propName: theCtx.propName,
    recordName: theCtx.recordName,
  };
}

export async function getSourceLocOfGraphQL(
  opName: string
): Promise<{ fileName: string; componentName: string } | null> {
  const relayConfig = await loadRelayConfig();

  if (relayConfig == null) {
    return null;
  }

  return new Promise((resolve) => {
    let i = 0;

    lineReader.eachLine(
      path.resolve(
        path.join(relayConfig.artifactDirectory, `${opName}_graphql.res`)
      ),
      (line) => {
        i += 1;

        const sourceLoc = line.match(sourceLocExtractor)?.[0];
        if (sourceLoc != null) {
          resolve({
            fileName: sourceLoc,
            componentName: `${sourceLoc[0].toUpperCase()}${sourceLoc.slice(
              1,
              sourceLoc.length - 4
            )}`,
          });
          return false;
        }

        if (i > 3) {
          resolve(null);
          return false;
        }
      }
    );
  });
}
