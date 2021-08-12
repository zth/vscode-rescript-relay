import semver from "semver";

export function hasHighEnoughReScriptRelayVersion(version: string): boolean {
  return semver.satisfies(version.replace(/[\^\~]/g, ""), ">=0.13.0");
}
