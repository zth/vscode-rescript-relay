const validReScriptVariableNameRegexp = new RegExp(/^[a-z][a-zA-Z_0-9]+$/);

export const validateRescriptVariableName = (str: string): boolean =>
  validReScriptVariableNameRegexp.test(str);

export const extractFragmentRefs = (str: string): string[] => {
  const regex = /RescriptRelay\.fragmentRefs<\s*\[(.*)\]/gm;
  let m: any;
  const res: string[] = [];

  while ((m = regex.exec(str)) !== null) {
    if (m.index === regex.lastIndex) {
      regex.lastIndex++;
    }

    if (m[1] != null) {
      const raw = m[1].trim();
      console.log(raw);
      const extrRegex = /#(\w+)/g;
      let f: any;
      while ((f = extrRegex.exec(raw)) !== null) {
        res.push(f[1].replace("#", ""));
      }
    }
  }

  return res.reduce((acc: string[], curr: string) => {
    if (acc.includes(curr)) {
      return acc;
    }

    acc.push(curr);
    return acc;
  }, []);
};
