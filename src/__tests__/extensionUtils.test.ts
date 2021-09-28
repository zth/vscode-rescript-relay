import {
  extractFragmentRefs,
  validateRescriptVariableName,
} from "../extensionUtilsNoVscode";

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

describe("extractFragmentRefs", () => {
  it("should extract fragmentRefs", () => {
    expect(
      extractFragmentRefs(`fragmentRefs: RescriptRelay.fragmentRefs<
    [#TodoListT_item | #TodoListTest_item],
  >
  
  type fragment = {
    todosConnection: fragment_todosConnection,
    fragmentRefs: RescriptRelay.fragmentRefs<
      [#TodoListT_item | #TodoListTest_item],
    >,
  }`)
    ).toEqual(["TodoListT_item", "TodoListTest_item"]);

    expect(
      extractFragmentRefs(`fragmentRefs: RescriptRelay.fragmentRefs<[#Avatar_user]>

    type fragment_assignee_User = {
      fragmentRefs: RescriptRelay.fragmentRefs<[#Avatar_user]>,
    }`)
    ).toEqual(["Avatar_user"]);

    expect(
      extractFragmentRefs(`fragmentRefs: RescriptRelay.fragmentRefs<
    [
      | #TopBarImportantSectionDataUpdatedNotifier_organization
      | #TopBarImportantSectionUrgentApiConnectionIssues_organization
    ],
  >
  
  type fragment_organizationBySlug = {
    fragmentRefs: RescriptRelay.fragmentRefs<
      [
        | #TopBarImportantSectionDataUpdatedNotifier_organization
        | #TopBarImportantSectionUrgentApiConnectionIssues_organization
      ],
    >,
  }`)
    ).toEqual([
      "TopBarImportantSectionDataUpdatedNotifier_organization",
      "TopBarImportantSectionUrgentApiConnectionIssues_organization",
    ]);
  });
});
