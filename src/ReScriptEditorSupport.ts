import { fileURLToPath } from "url";
import * as path from "path";
import { execFileSync } from "child_process";
import fs from "fs";
import * as os from "os";
import {
  DocumentUri,
  HoverParams,
  ReferenceParams,
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

let tempFilePrefix = "rescript_format_file_" + process.pid + "__";
let tempFileId = 0;

let createFileInTempDir = (extension = "") => {
  let tempFileName = tempFilePrefix + tempFileId + extension;
  tempFileId = tempFileId + 1;
  return path.join(os.tmpdir(), tempFileName);
};

export function runCompletionCommand(
  msg: RequestMessage,
  textContent: string,
  extRootDir: string
) {
  let params = msg.params as ReferenceParams;
  let filePath = fileURLToPath(params.textDocument.uri);
  let code = textContent;
  let tmpname = createFileInTempDir();
  fs.writeFileSync(tmpname, code, { encoding: "utf-8" });

  let response = runAnalysisCommand(
    filePath,
    [
      "completion",
      filePath,
      params.position.line,
      params.position.character,
      tmpname,
    ],
    msg,
    extRootDir
  );
  fs.unlink(tmpname, () => null);
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
