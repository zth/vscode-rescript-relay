# vscode-rescript-relay

Improve quality-of-life of using ReScriptRelay with VSCode. **This requires ReasonRelay of version >= 0.13.0 and that you only use ReScript syntax with ReasonRelay.**

## Setup

Right now, you'll need to open VSCode in the _root where you've installed Relay_. For monorepos, this means you'll need to open the subfolder where your frontend project using Relay is located. This will hopefully be fixed in the future.

> In addition to this extension, you're encouraged to also install `vscode-graphiql-explorer` for the best experience.

This extension should _Just Work(tm)_, as it finds and uses your `relay.config.js`.

## Features

### General

- Syntax highlighting for GraphQL in ReScript.
- Autocomplete and validations for your GraphQL operations using the official GraphQL Language Server. Including for Relay specific directives.
- Automatically formatting all GraphQL operations in your documents on save using `prettier`.
- Run the Relay compiler through VSCode directly, and get notified when it errors.
- Project is refreshed and recompiled whenever `relay.config.js` changes.
- A ton of codegen and automatic GraphQL refactoring is supported.
- Easily generate new components, extract existing selections to new fragment components, etc.

### Code generation

Provides commands to generate boilerplate for `fragments`, `queries`, `mutations` and `subscriptions` via the commands:

- `> Add fragment`
- `> Add query`
- `> Add mutation`
- `> Add subscription`

The added GraphQL definition can also automatically be edited in GraphiQL using the `vscode-graphiql-explorer` extension if that is installed.

### Relay GraphQL Code actions

#### Add new fragment component at location in GraphQL operation

Inside any GraphQL definition, put your cursor on a field, activate code actions and choose `Add new fragment component here`. This will create a new component with a fragment and add that fragment next to your cursor.

#### Extract field selections to new fragment component

Inside any GraphQL definition, select any number of fields, activate code actions and choose `Extract selection to fragment component`. This will take your field selection and create a new component with a fragment including your selected fields. The fields you selected can optionally be removed from where they were extracted too if wanted, and the newly created fragment will be spread where you extracted the fields, setting up everything needed for you automatically.

#### Automatically set up fragment for pagination

Place your cursor on a `connection` field (basically a field of any GraphQL type that ends with `Connection`). Activate code actions, and select `Set up pagination for fragment`. This will setup all needed directives on your fragment to enable pagination.

#### Expand union and interface members

Place your cursor on any field name of a field that's a union or interface, activate code actions, and select `Expand union/interface members`. All union/interface members will be expanded, including selecting its first field.

#### Make fragment refetchable

With the cursor in a fragment definition, activate code actions and select `Make fragment refetchable`. This will add the `@refetchable` directive to the fragment, with a suitable `queryName` preconfigured, making it possible to refetch the fragment.

#### Add variable to `@argumentDefinitions`

In a fragment, add a variable to any argument for a field, like `myField @include(if: $showMyField)`. Put your cursor on the variable name `$showMyField` and activate code actions. Select `Add variable to @argumentDefinitions`. The variable is added to the fragments `@argumentDefinitions`, like `fragment SomeFragment_user on User @argumentDefinitions(showMyField: {type: "Boolean" })`.

#### Make fragment plural

With the cursor in a fragment definition, activate code actions and select `Make fragment plural`. The Relay directive for saying that a fragment is plural ıs added to the fragment definition.

#### Make fragment inline

With the cursor in a fragment definition, activate code actions and select `Make fragment inline`. The Relay directive for saying that this fragment should _always be unmasked wherever spread_ is added to the fragment.

## Roadmap

Here's a list of features (in no particular order of importance or scope size) that I'd like to add support for at some point:

- "Diagnostics" like notifying the user about custom scalars that don't have proper definition in `relay.config.js`
- Autosetup ReScriptRelay in a project via VSCode (install packages, setup `bsconfig.json`, add needed files, etc)
- Code action for inserting the `@connection` directive
- Tie the extension together with the docs much more. Make it easy to open the relevant part of the docs depending on what you're doing.
