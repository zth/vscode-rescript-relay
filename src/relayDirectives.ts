import { parse, DirectiveDefinitionNode } from "graphql";

const directives = parse(`
directive @relay_test_operation on QUERY | MUTATION | SUBSCRIPTION

directive @inline on FRAGMENT_DEFINITION

directive @raw_response_type on QUERY | MUTATION | SUBSCRIPTION

#directive @relay_early_flush on QUERY

directive @refetchable(queryName: String!) on FRAGMENT_DEFINITION

#directive @preloadable on QUERY

directive @relay(
  mask: Boolean
  plural: Boolean
) on FRAGMENT_DEFINITION | FRAGMENT_SPREAD

# Handles
directive @__clientField(
  filters: [String!]
  handle: String!
  key: String
) on FIELD

# MatchTransform
directive @match(key: String) on FIELD

directive @module(name: String!) on FRAGMENT_SPREAD

# ConnectionTransform
directive @connection(
  key: String!
  filters: [String]
  handler: String
  dynamicKey_UNSTABLE: String
) on FIELD

directive @stream_connection(
  key: String!
  filters: [String]
  handler: String
  label: String!
  initial_count: Int!
  if: Boolean = true
  use_customized_batch: Boolean = false
  dynamicKey_UNSTABLE: String
) on FIELD

# TODO: Add RequiredFieldAction

# DeclarativeConnection
directive @deleteRecord on FIELD
directive @deleteEdge(connections: [ID!]!) on FIELD
directive @appendEdge(connections: [ID!]!) on FIELD
directive @prependEdge(connections: [ID!]!) on FIELD
directive @appendNode(connections: [ID!]!, edgeTypeName: String!) on FIELD
directive @prependNode(connections: [ID!]!, edgeTypeName: String!) on FIELD
`);

export const directiveNodes: DirectiveDefinitionNode[] = directives.definitions.reduce(
  (acc: DirectiveDefinitionNode[], curr) => {
    if (curr.kind === "DirectiveDefinition") {
      acc.push(curr);
    }

    return acc;
  },
  []
);
