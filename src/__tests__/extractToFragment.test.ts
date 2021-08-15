import {
  parse,
  Source,
  print,
  buildSchema,
  SelectionNode,
  DirectiveNode,
  ArgumentNode,
} from "graphql";
import { extractToFragment } from "../createNewFragmentComponentsUtils";
import { getSelectedGraphQLOperation } from "../findGraphQLSources";
import { makeArgumentDefinitionVariable } from "../graphqlUtilsNoVscode";

const makeMockNormalizedSelection = (
  startLine: number,
  endLine: number
): [any, any] => [{ line: startLine }, { line: endLine }];

const printExtractedFragment = (
  parentTypeName: string,
  selections: SelectionNode[],
  fragmentDirectives: DirectiveNode[] = []
) =>
  print({
    kind: "FragmentDefinition",
    typeCondition: {
      kind: "NamedType",
      name: { kind: "Name", value: parentTypeName },
    },
    name: { kind: "Name", value: "SomeFragment_user" },
    directives: fragmentDirectives,
    selectionSet: {
      kind: "SelectionSet",
      selections: selections,
    },
  });

const mockSchema = `
type User {
    id: ID!
    firstName: String!
    lastName: String!
    bestFriend: Friend!
    fullName(format: String): String!
}

type Friend {
    id: ID!
    avatarUrl: String!
    friendsSince: Int!
    status: FriendStatus
}

type FriendStatus {
  since: Int!
  from: String
  to: String
}
`;

const schema = buildSchema(mockSchema);

const targetSource = `// Other stuff

module Fragment = %relay(\`
  fragment SomeFragment_user on User {
    id
    firstName
    lastName
    bestFriend {
        id
        avatarUrl
        friendsSince
        status {
            since
            from 
            to
        }
    }
    fullName(format: $format)
  }
\`
)

// Some other source here
      `;

const selectedOp = getSelectedGraphQLOperation(targetSource, {
  line: 6,
  character: 2,
} as any);

if (!selectedOp) {
  throw new Error("Select an op please..");
}

const parsedOp = parse(selectedOp.content);
const source = new Source(selectedOp.content);

describe("Extract to fragment component", () => {
  it("extracts in simple cases", () => {
    const extractedFragment = extractToFragment({
      schema,
      normalizedSelection: makeMockNormalizedSelection(4, 6),
      parsedOp,
      source,
    });

    if (!extractedFragment) {
      throw new Error("Could not extract fragment.");
    }

    expect(
      printExtractedFragment(
        extractedFragment.parentTypeName,
        extractedFragment.selections
      )
    ).toMatchSnapshot();
  });

  it("extracts in slightly more advanced examples", () => {
    const extractedFragment = extractToFragment({
      schema,
      normalizedSelection: makeMockNormalizedSelection(8, 15),
      parsedOp,
      source,
    });

    if (!extractedFragment) {
      throw new Error("Could not extract fragment.");
    }

    expect(
      printExtractedFragment(
        extractedFragment.parentTypeName,
        extractedFragment.selections
      )
    ).toMatchSnapshot();
  });

  it("extracts even when nested quite far", () => {
    const extractedFragment = extractToFragment({
      schema,
      normalizedSelection: makeMockNormalizedSelection(12, 13),
      parsedOp,
      source,
    });

    if (!extractedFragment) {
      throw new Error("Could not extract fragment.");
    }

    expect(
      printExtractedFragment(
        extractedFragment.parentTypeName,
        extractedFragment.selections
      )
    ).toMatchSnapshot();
  });

  it("adds any variables encountered as argumentDefinitions", () => {
    const extractedFragment = extractToFragment({
      schema,
      normalizedSelection: makeMockNormalizedSelection(16, 16),
      parsedOp,
      source,
    });

    if (!extractedFragment) {
      throw new Error("Could not extract fragment.");
    }

    const vars = Object.entries(extractedFragment.variables);

    const argumentDefinitions: DirectiveNode | null =
      vars.length > 0
        ? {
            kind: "Directive",
            name: {
              kind: "Name",
              value: "argumentDefinitions",
            },
            arguments: vars.map(
              ([varName, type]): ArgumentNode =>
                makeArgumentDefinitionVariable(varName, type)
            ),
          }
        : null;

    expect(
      printExtractedFragment(
        extractedFragment.parentTypeName,
        extractedFragment.selections,
        argumentDefinitions != null ? [argumentDefinitions] : []
      )
    )
      .toBe(`fragment SomeFragment_user on User @argumentDefinitions(format: {type: "String"}) {
  fullName(format: $format)
}`);
  });
});
