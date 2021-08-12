import { workspace } from "vscode";

export function getPreferredFragmentPropName(onType: string): string {
  const result =
    workspace.getConfiguration("rescript-relay").get("preferShortNames") ===
    true
      ? onType.split(/(?=[A-Z])|_/g).pop() ?? onType
      : onType;

  // Handle common ReScript keywords
  if (result.toLowerCase().endsWith("type")) {
    return result.slice(0, result.length - 1);
  }

  return result;
}

export const experimentalModeEnabled = () =>
  workspace.getConfiguration("rescript-relay").get("experimentalFeatures") ===
  true;
