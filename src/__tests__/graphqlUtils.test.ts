import { buildSchema, parse, print } from "graphql";
import { addFieldAtPosition } from "../contextUtilsNoVscode";

const mockSchema = buildSchema(`
type Dog {
  id: ID!
  name: String!
}

type Cat {
  id: ID!
  name: String!
}

union Pet = Dog | Cat

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
  pets: [Pet!]
}

type Query {
  me: User
}
`);

describe("addFieldAtPosition", () => {
  it("adds simple fields", () => {
    expect(
      print(
        addFieldAtPosition(
          parse(`fragment SomeFragment on User {
  id
}`),
          "fragment",
          // @ts-ignore
          mockSchema.getType("User"),
          "age",
          "fragment"
        )
      ).trim()
    ).toEqual(
      `fragment SomeFragment on User {
  id
  age
}`
    );
  });
  it("adds simple fields in nested position", () => {
    expect(
      print(
        addFieldAtPosition(
          parse(`fragment SomeFragment on User {
  id
  bestFriend {
    id
  }
}`),
          "fragment_bestFriend",
          // @ts-ignore
          mockSchema.getType("User"),
          "age",
          "fragment"
        )
      ).trim()
    ).toEqual(
      `fragment SomeFragment on User {
  id
  bestFriend {
    id
    age
  }
}`
    );
  });
  it("adds complex fields", () => {
    expect(
      print(
        addFieldAtPosition(
          parse(`fragment SomeFragment on User {
  id
}`),
          "fragment",
          // @ts-ignore
          mockSchema.getType("User"),
          "bestFriend",
          "fragment"
        )
      ).trim()
    ).toEqual(
      `fragment SomeFragment on User {
  id
  bestFriend {
    id
  }
}`
    );
  });
  it("adds complex fields in union", () => {
    expect(
      print(
        addFieldAtPosition(
          parse(`fragment SomeFragment on User {
  id
  pets {
    ... on Dog {
      id
    }
  }
}`),
          "fragment_pets_Dog",
          // @ts-ignore
          mockSchema.getType("Dog"),
          "name",
          "fragment"
        )
      ).trim()
    ).toEqual(
      `fragment SomeFragment on User {
  id
  pets {
    ... on Dog {
      id
      name
    }
  }
}`
    );
  });
});
