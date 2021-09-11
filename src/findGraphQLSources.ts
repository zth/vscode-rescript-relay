import { getLocator } from "locate-character";
import { GraphQLSource, GraphQLSourceFromTag } from "./extensionTypes";
import LRUCache from "lru-cache";

/**
 * A helper for extracting GraphQL operations from source via a regexp.
 * It assumes that the only thing the regexp matches is the actual content,
 * so if that's not true for your regexp you probably shouldn't use this
 * directly.
 */
export let makeExtractTagsFromSource = (
  regexp: RegExp
): ((text: string) => Array<GraphQLSourceFromTag>) => (
  text: string
): Array<GraphQLSourceFromTag> => {
  const locator = getLocator(text);
  const sources: Array<GraphQLSourceFromTag> = [];
  const asLines = text.split("\n");

  let result;
  while ((result = regexp.exec(text)) !== null) {
    let start = locator(result.index);
    let end = locator(result.index + result[0].length);

    // Figure out the module name. Given the formatter, it'll be on the same or
    // previous line.
    let moduleName = "UnknownModule";

    const matchLineWithModuleName = (line: string) =>
      line.match(/module (\w+) =/)?.[1];

    if (asLines[start.line]?.includes("module ")) {
      moduleName =
        matchLineWithModuleName(asLines[start.line]) ?? "UnknownModule";
    }

    if (asLines[start.line - 1]?.includes("module ")) {
      moduleName =
        matchLineWithModuleName(asLines[start.line - 1]) ?? "UnknownModule";
    }

    sources.push({
      type: "TAG",
      moduleName,
      content: result[0],
      start: {
        line: start.line,
        character: start.column,
      },
      end: {
        line: end.line,
        character: end.column,
      },
    });
  }

  return sources;
};

export const rescriptFileFilterRegexp = new RegExp(/(\%relay\()/g);
export const rescriptGraphQLTagsRegexp = new RegExp(
  /(?<=\%relay\([\s]*`)[\s\S.]+?(?=`[\s]*\))/g
);

export const extractGraphQLSourceFromReScript = makeExtractTagsFromSource(
  rescriptGraphQLTagsRegexp
);

const cache = new LRUCache<string, GraphQLSourceFromTag[]>(5);

export function extractGraphQLSources(
  document: string,
  useCache = true
): GraphQLSource[] | null {
  if (useCache) {
    const cached = cache.get(document);

    if (cached != null) {
      return cached;
    }

    const res = extractGraphQLSourceFromReScript(document);
    cache.set(document, res);
    return res;
  } else {
    return extractGraphQLSourceFromReScript(document);
  }
}

export function extractSelectedOperation(
  document: string,
  selection: {
    line: number;
    character: number;
  }
): GraphQLSource | null {
  const sources = extractGraphQLSources(document);

  if (!sources || sources.length < 1) {
    return null;
  }

  let targetSource: GraphQLSource | null = null;

  if (sources[0].type === "FULL_DOCUMENT") {
    targetSource = sources[0];
  } else {
    // A tag must be focused
    for (let i = 0; i <= sources.length - 1; i += 1) {
      const t = sources[i];

      if (
        t.type === "TAG" &&
        selection.line >= t.start.line &&
        selection.line <= t.end.line
      ) {
        targetSource = t;
      }
    }
  }

  return targetSource;
}

export function getSelectedGraphQLOperation(
  doc: string,
  pos: { line: number; character: number }
): GraphQLSourceFromTag | null {
  const selectedOperation = extractSelectedOperation(doc, {
    line: pos.line,
    character: pos.character,
  });

  if (selectedOperation && selectedOperation.type === "TAG") {
    return selectedOperation;
  }

  return null;
}
