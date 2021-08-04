import { fileURLToPath } from "url";
import * as path from "path";
import { execFileSync } from "child_process";
import fs from "fs";
import {
  DocumentUri,
  HoverParams,
  RequestMessage,
  ResponseMessage,
  TypeDefinitionParams,
} from "vscode-languageserver-protocol";

let bsconfigPartialPath = "bsconfig.json";

let findProjectRootOfFile = (source: DocumentUri): null | DocumentUri => {
  let dir = path.dirname(source);
  if (fs.existsSync(path.join(dir, bsconfigPartialPath))) {
    return dir;
  } else {
    if (dir === source) {
      // reached top
      return null;
    } else {
      return findProjectRootOfFile(dir);
    }
  }
};

const makeBinaryPath = (extRootDir: string) =>
  path.join(
    path.join(extRootDir, "server", "analysis_binaries"),
    process.platform,
    "rescript-editor-analysis.exe"
  );

export function runHoverCommand(msg: RequestMessage, extRootDir: string) {
  let params = msg.params as HoverParams;
  let filePath = fileURLToPath(params.textDocument.uri);
  let response = runAnalysisCommand(
    filePath,
    ["hover", filePath, params.position.line, params.position.character],
    msg,
    extRootDir
  );
  return response;
}

export function runTypeDefinitionCommand(
  msg: RequestMessage,
  extRootDir: string
) {
  let params = msg.params as TypeDefinitionParams;
  let filePath = fileURLToPath(params.textDocument.uri);
  let response = runAnalysisCommand(
    filePath,
    [
      "typeDefinition",
      filePath,
      params.position.line,
      params.position.character,
    ],
    msg,
    extRootDir
  );
  return response;
}

export let runAnalysisCommand = (
  filePath: DocumentUri,
  args: Array<any>,
  msg: RequestMessage,
  extRootDir: string
) => {
  let result = runAnalysisAfterSanityCheck(filePath, args, extRootDir);
  let response: ResponseMessage = {
    jsonrpc: "2.0",
    id: msg.id,
    result,
  };
  return response;
};

export let runAnalysisAfterSanityCheck = (
  filePath: DocumentUri,
  args: Array<any>,
  extRootDir: string
) => {
  const binaryPath = makeBinaryPath(extRootDir);
  let projectRootPath = findProjectRootOfFile(filePath);
  if (projectRootPath == null) {
    return null;
  }
  let stdout = execFileSync(binaryPath, args, {
    cwd: projectRootPath,
  });
  return JSON.parse(stdout.toString());
};
