import { startServer } from "graphql-language-service-server";
import { Range, Position } from "graphql-language-service-utils";
import { CachedContent } from "graphql-language-service-types";
import { extractGraphQLSources } from "./findGraphQLSources";
import { createGraphQLConfigSync } from "./graphqlConfig";
import { getRelayRoot } from "./loadSchema";

(async () => {
  try {
    console.log("startServer");
    await startServer({
      method: "node",
      config: createGraphQLConfigSync(getRelayRoot()!, true),
      parser: (doc: string) => {
        const sources = extractGraphQLSources("rescript", doc);

        return (sources || []).reduce((acc: CachedContent[], curr) => {
          if (curr.type === "TAG") {
            acc.push({
              query: curr.content,
              range: new Range(
                new Position(curr.start.line, curr.start.character),
                new Position(curr.end.line, curr.end.character)
              ),
            });
          }

          return acc;
        }, []);
      },
    });
  } catch (err) {
    console.error(err);
  }
})();
