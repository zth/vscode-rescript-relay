import { buildSchema } from "graphql";
import {
  extractContextFromHover,
  findGraphQLRecordContext,
} from "../contextUtilsNoVscode";

describe("extractContextFromHover", () => {
  it("finds the context of a hover string from the ReScript VSCode extension", () => {
    expect(
      extractContextFromHover(
        "x",
        "```rescript\nReasonReactExamples.SingleTicket_ticket_graphql.Types.fragment\n```\n\n```rescript\ntype fragment = {\n assignee: option<\n [\n | #UnselectedUnionMember(string)\n | #User(fragment_assignee_User)\n | #WorkingGroup(fragment_assignee_WorkingGroup)\n ],\n >,\n id: string,\n subject: string,\n lastUpdated: option<string>,\n trackingId: string,\n fragmentRefs: RescriptRelay.fragmentRefs<\n [#TicketStatusBadge_ticket],\n >,\n}\n```"
      )
    ).toEqual({
      fragmentName: "SingleTicket_ticket",
      recordName: "fragment",
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
      fragmentName: "SingleTicket_ticket",
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
      fragmentName: "SingleTicketWorkingGroup_workingGroup",
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
      mockSchema
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
      mockSchema
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
      mockSchema
    );

    expect(ctx?.type.name).toBe("ID");
    expect(ctx?.fieldTypeAsString).toBe("ID!");

    expect(ctx?.description).toBe(null);
  });
});
