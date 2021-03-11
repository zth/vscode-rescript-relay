## main

- Make it work with the officially released `rescript-relay` package.

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
