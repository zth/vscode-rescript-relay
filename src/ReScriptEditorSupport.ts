import { fileURLToPath } from "url";
import * as path from "path";
import { exec } from "child_process";
import fs from "fs";
import * as os from "os";
import { DocumentUri } from "vscode-languageserver-protocol";
import { Position } from "vscode";

let bsconfigPartialPath = "bsconfig.json";

let tempFilePrefix = "rescript_format_file_" + process.pid + "_";
let tempFileId = 0;

export let createFileInTempDir = (extension = "") => {
  let tempFileName = tempFilePrefix + tempFileId + extension;
  tempFileId = tempFileId + 1;
  return path.join(os.tmpdir(), tempFileName);
};

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
    path.join(extRootDir, "server"),
    process.platform,
    "rescript-editor-support.exe"
  );

let findExecutable = (uri: string, extRootDir: string) => {
  let filePath = fileURLToPath(uri);
  let projectRootPath = findProjectRootOfFile(filePath);
  const binaryPath = makeBinaryPath(extRootDir);
  if (projectRootPath == null) {
    return null;
  } else {
    return { binaryPath, filePath, cwd: projectRootPath };
  }
};

export function runDumpCommand(
  config: { fileUri: string; position: Position },
  onResult: (
    result: { hover?: string; definition?: { uri?: string; range: any } } | null
  ) => void,
  extRootDir: string
) {
  let executable = findExecutable(config.fileUri, extRootDir);
  if (executable == null) {
    onResult(null);
  } else {
    let command =
      executable.binaryPath +
      " dump " +
      executable.filePath +
      ":" +
      config.position.line +
      ":" +
      config.position.character;
    exec(command, { cwd: executable.cwd }, function(_error, stdout, _stderr) {
      let result = JSON.parse(stdout);
      if (result && result[0]) {
        onResult(result[0]);
      } else {
        onResult(null);
      }
    });
  }
}

export function runCompletionCommand(
  config: { fileUri: string; position: Position },
  code: string,
  onResult: (result: [{ label: string }] | null) => void,
  extRootDir: string
) {
  let executable = findExecutable(config.fileUri, extRootDir);
  if (executable == null) {
    onResult(null);
  } else {
    let tmpname = createFileInTempDir();
    fs.writeFileSync(tmpname, code, { encoding: "utf-8" });

    let command =
      executable.binaryPath +
      " complete " +
      executable.filePath +
      ":" +
      config.position.line +
      ":" +
      config.position.character +
      " " +
      tmpname;

    exec(command, { cwd: executable.cwd }, function(_error, stdout, _stderr) {
      // async close is fine. We don't use this file name again
      fs.unlink(tmpname, () => null);
      let result = JSON.parse(stdout);
      if (result && result[0]) {
        onResult(result);
      } else {
        onResult(null);
      }
    });
  }
}
