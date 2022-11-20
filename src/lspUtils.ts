import path from "path";
import { LanguageClient, RequestType } from "vscode-languageclient/node";

export interface SingleRoute {
  sourceFilePath: string;
  routeName: string;
  loc: { line: number; character: number };
}

const LSP_CUSTOM_REQUESTS = {
  rescriptRelayRouterRoutesRequest: new RequestType<
    string,
    SingleRoute[],
    void
  >("textDocument/rescriptRelayRouterRoutes"),
};

export const lspAskForRoutesForFile = (
  client: LanguageClient,
  fileUri: string
) => {
  return client.sendRequest(
    LSP_CUSTOM_REQUESTS.rescriptRelayRouterRoutesRequest,
    path.basename(fileUri, ".res")
  );
};
