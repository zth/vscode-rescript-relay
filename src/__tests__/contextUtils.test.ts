import { buildSchema } from "graphql";
import {
  extractContextFromHover,
  findGraphQLRecordContext,
} from "../contextUtilsNoVscode";

describe("extractContextFromHover", () => {
  it("finds the context of a hover string from the ReScript VSCode extension", () => {
    expect(
      extractContextFromHover(
        "```rescript\nReasonReactExamples.SingleTicket_ticket_graphql.Types.fragment\n```\n\n```rescript\ntype fragment = {\n assignee: option<\n [\n | #UnselectedUnionMember(string)\n | #User(fragment_assignee_User)\n | #WorkingGroup(fragment_assignee_WorkingGroup)\n ],\n >,\n id: string,\n subject: string,\n lastUpdated: option<string>,\n trackingId: string,\n fragmentRefs: RescriptRelay.fragmentRefs<\n [#TicketStatusBadge_ticket],\n >,\n}\n```"
      )
    ).toEqual({
      fragmentName: "SingleTicket_ticket",
      recordName: "fragment",
      fragments: ["TicketStatusBadge_ticket"],
    });
  });

  it("finds the context of a hover string with a more complex path", () => {
    expect(
      extractContextFromHover(
        "```rescript\nReasonReactExamples.SingleTicket_ticket_graphql.Types.fragment_user_friends_Friend_node\n```\n\n```rescript\ntype fragment = {\n assignee: option<\n [\n | #UnselectedUnionMember(string)\n | #User(fragment_assignee_User)\n | #WorkingGroup(fragment_assignee_WorkingGroup)\n ],\n >,\n id: string,\n subject: string,\n lastUpdated: option<string>,\n trackingId: string,\n fragmentRefs: RescriptRelay.fragmentRefs<\n [#TicketStatusBadge_ticket | #TicketHeader_ticket],\n >,\n}\n```"
      )
    ).toEqual({
      fragmentName: "SingleTicket_ticket",
      recordName: "fragment_user_friends_Friend_node",
      fragments: ["TicketStatusBadge_ticket", "TicketHeader_ticket"],
    });
  });

  it("does not match deceptively similar type names", () => {
    expect(
      extractContextFromHover(
        "```rescript\nReasonReactExamples.SingleTicket_ticket.Types.fragment_user_friends_Friend_node\n```\n\n```rescript\ntype fragment = {\n assignee: option<\n [\n | #UnselectedUnionMember(string)\n | #User(fragment_assignee_User)\n | #WorkingGroup(fragment_assignee_WorkingGroup)\n ],\n >,\n id: string,\n subject: string,\n lastUpdated: option<string>,\n trackingId: string,\n fragmentRefs: RescriptRelay.fragmentRefs<\n [#TicketStatusBadge_ticket],\n >,\n}\n```"
      )
    ).toEqual(null);
  });
});

const mockSchema = buildSchema(`
type User {
  id: ID!
  age: Int!
  bestFriend: User
}

type Query {
  me: User
}
`);

describe("findGraphQLRecordContext", () => {
  it.only("finds the relevant context", () => {
    const ctx = findGraphQLRecordContext(
      `fragment Test_user on User {
    id
    bestFriend {
      id
    }
}`,
      "fragment_bestFriend",
      mockSchema
    );

    expect(ctx?.type.name).toBe("User");
    expect(ctx?.startLoc?.line).toBe(3);
    expect(ctx?.endLoc?.line).toBe(5);

    expect(ctx?.startLoc?.column).toBe(5);
    expect(ctx?.endLoc?.column).toBe(6);
  });
});
