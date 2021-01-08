// Not used right now
const path = require("path");

const isProd = process.env.NODE_ENV === "production";

const config = {
  target: "node",
  entry: {
    extension: "./src/extension.ts",
    server: "./src/server.ts"
  },
  output: {
    path: path.resolve(__dirname, "build"),
    filename: "[name].js",
    libraryTarget: "commonjs2"
  },
  devtool: "source-map",
  externals: {
    vscode: "commonjs vscode",
    "vscode-languageserver": "vscode-languageserver",
    "vscode-languageserver-protocol": "vscode-languageserver-protocol",
    encoding: "encoding"
  },
  resolve: {
    extensions: [".mjs", ".js", ".ts"]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
            options: {
              compilerOptions: {
                module: "es6"
              }
            }
          }
        ]
      }
    ]
  }
};

module.exports = config;
