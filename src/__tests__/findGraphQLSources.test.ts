import * as fs from "fs";
import * as path from "path";
import { extractGraphQLSourceFromReScript } from "../findGraphQLSources";

const fixture = fs.readFileSync(
  path.resolve(
    path.join(__dirname, "../", "testfixture", "graphqlSources.res")
  ),
  "utf8"
);

describe("findGraphQLSources", () => {
  it("finds ReScript sources", () => {
    expect(extractGraphQLSourceFromReScript(fixture)).toMatchSnapshot();
  });
});
