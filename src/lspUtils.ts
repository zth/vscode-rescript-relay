import path from "path";
import { LanguageClient, RequestType } from "vscode-languageclient/node";

export interface SingleRoute {
  sourceFilePath: string;
  routeName: string;
  loc: { line: number; character: number };
  routeRendererFilePath: string;
}

const LSP_CUSTOM_REQUESTS = {
  routesForFile: new RequestType<string, SingleRoute[], void>(
    "textDocument/rescriptRelayRouterRoutes"
  ),
  matchUrl: new RequestType<string, SingleRoute[], void>(
    "textDocument/rescriptRelayRouterRoutesMatchingUrl"
  ),
};

export const routerLspRoutesForFile = (
  client: LanguageClient,
  fileUri: string
) => {
  return client.sendRequest(
    LSP_CUSTOM_REQUESTS.routesForFile,
    path.basename(fileUri, ".res")
  );
};

export const routerLspMatchUrl = (client: LanguageClient, url: string) => {
  return client.sendRequest(LSP_CUSTOM_REQUESTS.matchUrl, url);
};
