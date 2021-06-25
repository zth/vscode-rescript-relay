import semver from "semver";
import { workspace } from "vscode";

export function hasHighEnoughReScriptRelayVersion(version: string): boolean {
  return semver.satisfies(version.replace(/[\^\~]/g, ""), ">=0.13.0");
}

export function getPreferredFragmentPropName(onType: string): string {
  return workspace
    .getConfiguration("rescript-relay")
    .get("preferShortNames") === true
    ? onType.split(/(?=[A-Z])|_/g).pop() ?? onType
    : onType;
}
