import { SchemaLoader } from "./extensionTypes";
import * as fs from "fs";
import * as path from "path";

const getSchemaType = (schemaPath: string): "json" | "sdl" | null => {
  const schemaExtName = path.extname(schemaPath);

  return schemaExtName === ".graphql"
    ? "sdl"
    : schemaExtName === ".json"
    ? "json"
    : null;
};

/**
 * This file defines schema loaders, which are simply functions that
 * try to find the appropriate schema file in various ways.
 */
export const graphql_ppx_loader: SchemaLoader = async (
  rootPath: string,
  filesInRoot: Array<string>
) => {
  const schemaFile = filesInRoot.find(f => f === "graphql_schema.json");

  if (!schemaFile) {
    return null;
  }

  return {
    type: "json",
    content: fs.readFileSync(path.join(rootPath, schemaFile), "utf8")
  };
};

export const rawSchemaFileLoader: SchemaLoader = async (
  rootPath: string,
  filesInRoot: Array<string>
) => {
  const schemaFile = filesInRoot.find(
    f => f === "schema.graphql" || f === "schema.json"
  );

  if (!schemaFile) {
    return null;
  }

  const schemaType = getSchemaType(schemaFile);

  return schemaType
    ? {
        type: schemaType,
        content: fs.readFileSync(path.join(rootPath, schemaFile), "utf8")
      }
    : null;
};

export const loaders: Array<SchemaLoader> = [
  graphql_ppx_loader,
  rawSchemaFileLoader
];
