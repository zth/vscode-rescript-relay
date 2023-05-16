## main

## 0.11.4

- Allow `relay.config.json` as config file.

## 0.11.3

- More `RescriptRelayRouter` related tooling.

## 0.11.2

- More `RescriptRelayRouter` related tooling.

## 0.11.1

- Fix bug in experimental editor tooling for RescriptRelayRouter.

## 0.11.0

- Experimental editor tooling support for the unreleased RescriptRelayRouter.

## 0.10.0

- Use the official Relay LSP when available in a project (essentially for RescriptRelay versions `>1.0.0-beta.20`).
- Remove support for running the compiler automatically. This never worked well enough, and often resulted in weird ghost processes etc. And it's not needed in the same way now that the official Relay LSP is used when available.

## 0.9.3

- Fix fragment name generator generating illegal names in some cases.
- Support loading `relay.config.cjs` files.

## 0.9.2

- Add code action for opening source file for fragment spread.

## 0.9.1

- Add monorepo support. (@tsnobip)

## 0.9.0

- Check if watchman is installed and warn if not. (@mellson)

## 0.8.0

- Trigger completion of fragment components on dot-based autocompletes.
- More elborate control over how new fragment components are named.
- Various bug fixes for the `@connection` code action.

## 0.7.0

- Enable all experimental features by default, and put most of them behind toggleable settings (that are on by default).

## 0.6.2

- Detailed hover for `dataId`, and autocomplete (via pipe) `someDataId->RescriptRelay.dataIdToString` when possible.
- Jump-to-definition for fragment spreads in GraphQL operations.
- Never emit `_` in generated module names, as it clashes with what Relay expects.

## 0.6.1

- Code action for adding `@connection`.
- Look up GraphQL between files to be able to provide (some) hover info when a type isn't accessed in its original file.
- Enable new experimental features for queries, mutations and subscriptions.

## 0.6.0

- A ton of new features, currently hidden by a "experimental features" settings in the extension settings. Enable it and try them out ;) Documentation etc will follow in the upcoming releases as the experiemental features stabilize.

## 0.5.5

- Fix issues with the extension accidentally creating Relay compiler processes that it doesn't also shut down properly. Shout out to @mellson.

## 0.5.4

- The extension is now bundled properly via `esbuild`.
- Add config for preferring short names. Adding a fragment on `TodoItem` in `SomeFile.res` now names the fragment `SomeFile_item` instead of `SomeFile_todoItem`, which tends to get quite long for types with long names.
- Add command for creating a new file with a fragment in it.

## 0.5.3

- Fix ghost errors caused by the extension adding erronous GraphQL to the schema (invalid wrt the spec, but valid in Relay).

## 0.5.2

- Schema changes are now also automatically picked up for code actions.
- `rescript-relay` can now be detected in `peerDependencies` as well (thanks @mellson).
- Remove a few lingering references to ReasonRelay.

## 0.5.1

- Add command to create lazy loaded version of current component.

## 0.5.0

- Add code action for adding variable to operation definition.
- Add explicit extra stop button when the Relay compiler has an error.

## 0.4.0

- Make it work with the officially released `rescript-relay` package.
- Remove `vscode-graphiql-explorer` integration.
- Add option to add query boilerplate for preloaded query.
- Add step for selecting what type to expand when generating a query that uses the node interface/node top level field.
- Add step for autogenerating any needed variables etc when codegenning mutations.
- Add code actions for adding `@appendNode/prependNode/appendEdge/prependEdge/deleteRecord/deleteEdge`.
- Fragments can now easily be added to the root operation/fragment itself, as well as on interfaces and unions.

## 0.3.6

- Fix up detection of the ReScriptRelay version.

## 0.3.5

- Small bug fix, make the GraphQL LSP work again.

## 0.3.4

- Small bug fix.

## 0.3.3

- Print error when detecting ReasonRelay/ReScriptRelay versions that aren't high enough to support this extension.

## 0.3.1

- Adding fragments/queries/mutations/subscriptions is now done properly through ASTs, which will increase the stability of using them quite a lot.

## 0.3.0

- Automatically restart RLS (if it's installed) whenever the Relay compiler has changed generated files. This works around the issue where RLS does not pick up that the Relay compiler has emitted new files, or changed existing generated files.
- Run the Relay compiler through VSCode automatically, and report errors discovered by the compiler inside VSCode.
- Refresh the project whenever `relay.confg.js` changes.
- Settings page added.

## 0.2.1

- Update README with a list of the current features of the extension.

## 0.2.0

- Restore autocomplete functionality again, that broke somewhere along the way.
- Fix potential with fragment component generation from types with lower cased names.

## 0.1.0

- Initial release.
