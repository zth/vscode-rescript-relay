import { validateRescriptVariableName } from "../extensionUtilsNoVscode";

describe("validateRescriptVariableName", () => {
  it("should validate ReScript variable names", () => {
    expect(validateRescriptVariableName("someProp")).toBe(true);
    expect(validateRescriptVariableName("SomeProp")).toBe(false);
    expect(validateRescriptVariableName("123_lol")).toBe(false);
    expect(validateRescriptVariableName("lol_123")).toBe(true);
    expect(validateRescriptVariableName("todoL")).toBe(true);
    expect(validateRescriptVariableName("TodoL")).toBe(false);
    expect(validateRescriptVariableName("todo ")).toBe(false);
  });
});
