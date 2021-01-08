import { getLocator } from "locate-character";
import { GraphQLSource, GraphQLSourceFromTag } from "./extensionTypes";

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
  let result;
  while ((result = regexp.exec(text)) !== null) {
    let start = locator(result.index);
    let end = locator(result.index + result[0].length);

    sources.push({
      type: "TAG",
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

export const jsGraphQLTagsRegexp = new RegExp(
  /(?<=(graphql|gql|graphql\.experimental)`)[.\s\S]+?(?=`)/g
);
export const rescriptFileFilterRegexp = new RegExp(/(\%relay\()/g);
export const rescriptGraphQLTagsRegexp = new RegExp(
  /(?<=\%relay\([\s]*`)[\s\S.]+?(?=`[\s]*\))/g
);

const extractGraphQLSourceFromJs = makeExtractTagsFromSource(
  jsGraphQLTagsRegexp
);

export const extractGraphQLSourceFromReScript = makeExtractTagsFromSource(
  rescriptGraphQLTagsRegexp
);

export function extractGraphQLSources(
  languageId: string,
  document: string
): GraphQLSource[] | null {
  switch (languageId) {
    case "graphql":
      return [
        {
          type: "FULL_DOCUMENT",
          content: document,
        },
      ];
    case "javascript":
    case "javascriptreact":
    case "typescript":
    case "typescriptreact":
    case "vue":
      return extractGraphQLSourceFromJs(document);
    case "rescript":
      return extractGraphQLSourceFromReScript(document);
    default:
      return null;
  }
}

export function extractSelectedOperation(
  languageId: string,
  document: string,
  selection: {
    line: number;
    character: number;
  }
): GraphQLSource | null {
  const sources = extractGraphQLSources(languageId, document);

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
  const selectedOperation = extractSelectedOperation("rescript", doc, {
    line: pos.line,
    character: pos.character,
  });

  if (selectedOperation && selectedOperation.type === "TAG") {
    return selectedOperation;
  }

  return null;
}
