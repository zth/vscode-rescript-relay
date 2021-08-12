import { buildSchema } from "graphql";
import {
  extractContextFromHover,
  findGraphQLRecordContext,
  findRecordAndModulesFromCompletion,
} from "../contextUtilsNoVscode";

describe("extractContextFromHover", () => {
  it("finds the context of a hover string from the ReScript VSCode extension", () => {
    expect(
      extractContextFromHover(
        "x",
        "```rescript\nReasonReactExamples.SingleTicket_ticket_graphql.Types.fragment\n```\n\n```rescript\ntype fragment = {\n assignee: option<\n [\n | #UnselectedUnionMember(string)\n | #User(fragment_assignee_User)\n | #WorkingGroup(fragment_assignee_WorkingGroup)\n ],\n >,\n id: string,\n subject: string,\n lastUpdated: option<string>,\n trackingId: string,\n fragmentRefs: RescriptRelay.fragmentRefs<\n [#TicketStatusBadge_ticket],\n >,\n}\n```"
      )
    ).toEqual({
      graphqlName: "SingleTicket_ticket",
      graphqlType: "fragment",
      recordName: "fragment",
      propName: "x",
    });
  });

  it("finds the context of a hover string from the ReScript VSCode extension, for queries", () => {
    expect(
      extractContextFromHover(
        "x",
        "```rescript\nReasonReactExamples.SingleTicketQuery_graphql.Types.response\n```\n\n```rescript\ntype fragment = {\n assignee: option<\n [\n | #UnselectedUnionMember(string)\n | #User(fragment_assignee_User)\n | #WorkingGroup(fragment_assignee_WorkingGroup)\n ],\n >,\n id: string,\n subject: string,\n lastUpdated: option<string>,\n trackingId: string,\n fragmentRefs: RescriptRelay.fragmentRefs<\n [#TicketStatusBadge_ticket],\n >,\n}\n```"
      )
    ).toEqual({
      graphqlName: "SingleTicketQuery",
      graphqlType: "query",
      recordName: "response",
      propName: "x",
    });
  });

  it("finds the context of a hover string from the ReScript VSCode extension, alternate formatting", () => {
    expect(
      extractContextFromHover(
        "x",
        '```rescript"TodoList_query_graphql-ReasonReactExamples".Types.fragment_todosConnection_edges_node\n        type fragment_todosConnection_edges_node = {\n          id: string,\n          fragmentRefs: RescriptRelay.fragmentRefs<\n            [#SingleTodo_todoItem],\n          >,\n        }```'
      )
    ).toEqual({
      graphqlName: "TodoList_query",
      graphqlType: "fragment",
      recordName: "fragment_todosConnection_edges_node",
      propName: "x",
    });
  });

  it("finds the context of a hover string with a more complex path", () => {
    expect(
      extractContextFromHover(
        "x",
        "```rescript\nReasonReactExamples.SingleTicket_ticket_graphql.Types.fragment_user_friends_Friend_node\n```\n\n```rescript\ntype fragment = {\n assignee: option<\n [\n | #UnselectedUnionMember(string)\n | #User(fragment_assignee_User)\n | #WorkingGroup(fragment_assignee_WorkingGroup)\n ],\n >,\n id: string,\n subject: string,\n lastUpdated: option<string>,\n trackingId: string,\n fragmentRefs: RescriptRelay.fragmentRefs<\n [#TicketStatusBadge_ticket | #TicketHeader_ticket],\n >,\n}\n```"
      )
    ).toEqual({
      propName: "x",
      graphqlName: "SingleTicket_ticket",
      graphqlType: "fragment",
      recordName: "fragment_user_friends_Friend_node",
    });
  });

  it("finds the context of wrapped option strings", () => {
    expect(
      extractContextFromHover(
        "x",
        `array<
        option<
          ReasonReactExamples.SingleTicketWorkingGroup_workingGroup_graphql.Types.fragment_membersConnection_edges,
        >,
      >`
      )
    ).toEqual({
      propName: "x",
      graphqlName: "SingleTicketWorkingGroup_workingGroup",
      graphqlType: "fragment",
      recordName: "fragment_membersConnection_edges",
    });
  });

  it("does not match deceptively similar type names", () => {
    expect(
      extractContextFromHover(
        "x",
        "```rescript\nReasonReactExamples.SingleTicket_ticket.Types.fragment_user_friends_Friend_node\n```\n\n```rescript\ntype fragment = {\n assignee: option<\n [\n | #UnselectedUnionMember(string)\n | #User(fragment_assignee_User)\n | #WorkingGroup(fragment_assignee_WorkingGroup)\n ],\n >,\n id: string,\n subject: string,\n lastUpdated: option<string>,\n trackingId: string,\n fragmentRefs: RescriptRelay.fragmentRefs<\n [#TicketStatusBadge_ticket],\n >,\n}\n```"
      )
    ).toEqual(null);
  });

  it("ignores functions", () => {
    expect(
      extractContextFromHover(
        "x",
        `\"RecentTickets_query_graphql-ReasonReactExamples".Types.fragment_ticketsConnection => array<
        \"RecentTickets_query_graphql-ReasonReactExamples".Types.fragment_ticketsConnection_edges_node,
      >`
      )
    ).toEqual(null);
  });

  it("uses correct heuristic for unions", () => {
    expect(
      extractContextFromHover(
        "x",
        "```rescript\n[\n          | #WorkingGroup(ReasonReactExamples.SingleTicket_ticket_graphql.Types.fragment_assignee_WorkingGroup)\n          | #User(ReasonReactExamples.SingleTicket_ticket_graphql.Types.fragment_assignee_User)\n          | #UnselectedUnionMember(string)\n        ]\n```"
      )
    ).toEqual({
      graphqlName: "SingleTicket_ticket",
      graphqlType: "fragment",
      propName: "x",
      recordName: "fragment_assignee",
    });
  });
});

const mockSchema = buildSchema(`
"""
A user.
"""
type User {
  id: ID!
  """
  The age of the user.
  """
  age: Int!
  bestFriend: User
}

type Query {
  me: User
}
`);

describe("findGraphQLRecordContext", () => {
  it("finds the relevant context", () => {
    const ctx = findGraphQLRecordContext(
      `fragment Test_user on User {
    id
    bestFriend {
      id
      age
    }
}`,
      "fragment_bestFriend",
      mockSchema,
      "fragment"
    );

    expect(ctx?.type.name).toBe("User");
    expect(ctx?.startLoc?.line).toBe(3);
    expect(ctx?.endLoc?.line).toBe(6);

    expect(ctx?.startLoc?.column).toBe(5);
    expect(ctx?.endLoc?.column).toBe(6);

    expect(ctx?.description).toBe("A user.");
  });

  it("finds the relevant context of a single field", () => {
    const ctx = findGraphQLRecordContext(
      `fragment Test_user on User {
    id
    bestFriend {
      id
      age
    }
}`,
      "fragment_bestFriend_age",
      mockSchema,
      "fragment"
    );

    expect(ctx?.type.name).toBe("Int");
    expect(ctx?.fieldTypeAsString).toBe("Int!");
    expect(ctx?.startLoc?.line).toBe(5);
    expect(ctx?.endLoc?.line).toBe(5);

    expect(ctx?.startLoc?.column).toBe(7);
    expect(ctx?.endLoc?.column).toBe(10);

    expect(ctx?.description).toBe("The age of the user.");
  });

  it("excludes built in scalar descriptions", () => {
    const ctx = findGraphQLRecordContext(
      `fragment Test_user on User {
    id
    bestFriend {
      id
      age
    }
}`,
      "fragment_bestFriend_id",
      mockSchema,
      "fragment"
    );

    expect(ctx?.type.name).toBe("ID");
    expect(ctx?.fieldTypeAsString).toBe("ID!");

    expect(ctx?.description).toBe(null);
  });
});

describe("findRecordAndModulesFromCompletion", () => {
  it("handles completion items for fragments", () => {
    expect(
      findRecordAndModulesFromCompletion({
        label: "user",
        detail:
          "ReasonReactExamples.SingleTicket_ticket_graphql.Types.fragment_assignee_User",
      })
    ).toEqual({
      label: "user",
      module: "SingleTicket_ticket_graphql",
      graphqlName: "SingleTicket_ticket",
      graphqlType: "fragment",
      recordName: "fragment_assignee_User",
    });
  });

  it("handles completion items for queries", () => {
    expect(
      findRecordAndModulesFromCompletion({
        label: "user",
        detail:
          "ReasonReactExamples.SingleTicketQuery_graphql.Types.response_assignee_User",
      })
    ).toEqual({
      label: "user",
      module: "SingleTicketQuery_graphql",
      graphqlName: "SingleTicketQuery",
      graphqlType: "query",
      recordName: "response_assignee_User",
    });
  });

  it("handles completion items for mutations", () => {
    expect(
      findRecordAndModulesFromCompletion({
        label: "user",
        detail:
          "ReasonReactExamples.SingleTicketMutation_graphql.Types.response_assignee_User",
      })
    ).toEqual({
      label: "user",
      module: "SingleTicketMutation_graphql",
      graphqlName: "SingleTicketMutation",
      graphqlType: "mutation",
      recordName: "response_assignee_User",
    });
  });

  it("handles completion items for subscriptions", () => {
    expect(
      findRecordAndModulesFromCompletion({
        label: "user",
        detail:
          "ReasonReactExamples.SingleTicketSubscription_graphql.Types.response_assignee_User",
      })
    ).toEqual({
      label: "user",
      module: "SingleTicketSubscription_graphql",
      graphqlName: "SingleTicketSubscription",
      graphqlType: "subscription",
      recordName: "response_assignee_User",
    });
  });

  it("handles completion items with differen formatting", () => {
    expect(
      findRecordAndModulesFromCompletion({
        label: "todoItem",
        detail: `\"TodoList_query_graphql-ReasonReactExamples".Types.fragment_todosConnection_edges_node`,
      })
    ).toEqual({
      label: "todoItem",
      module: "TodoList_query_graphql",
      graphqlName: "TodoList_query",
      graphqlType: "fragment",
      recordName: "fragment_todosConnection_edges_node",
    });
  });

  it("ignores irrelevant stuff", () => {
    expect(
      findRecordAndModulesFromCompletion({
        label: "user",
        detail: "string",
      })
    ).toEqual(null);
  });
});
