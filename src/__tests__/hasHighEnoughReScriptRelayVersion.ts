import { hasHighEnoughReScriptRelayVersion } from "../utils";

it("identifies high enough versions", () => {
  expect(hasHighEnoughReScriptRelayVersion("0.13.0")).toBe(true);
  expect(hasHighEnoughReScriptRelayVersion("^0.13.0")).toBe(true);
  expect(hasHighEnoughReScriptRelayVersion("~0.13.0")).toBe(true);
  expect(hasHighEnoughReScriptRelayVersion("0.14.0")).toBe(true);
  expect(hasHighEnoughReScriptRelayVersion("^0.14.0")).toBe(true);
  expect(hasHighEnoughReScriptRelayVersion("~0.14.0")).toBe(true);
  expect(hasHighEnoughReScriptRelayVersion("1.0.0")).toBe(true);
  expect(hasHighEnoughReScriptRelayVersion("^1.0.0")).toBe(true);
  expect(hasHighEnoughReScriptRelayVersion("2.0.0")).toBe(true);
  expect(hasHighEnoughReScriptRelayVersion("^2.0.0")).toBe(true);
});
