import { spawnSync } from "child_process";

export const matchWithComby = (
  command: string,
  content: string
): Promise<string> => {
  const res = spawnSync(
    "comby",
    [
      `'${command}'`,
      "''",
      "-stdin",
      "-match-only",
      "-json-lines",
      "-match-newline-at-toplevel",
      "-matcher",
      ".re",
    ],
    {
      shell: true,
      stdio: "pipe",
      input: content,
      encoding: "utf-8",
    }
  );

  return JSON.parse(res.output.filter(Boolean).join(""));
};
