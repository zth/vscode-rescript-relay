const validReScriptVariableNameRegexp = new RegExp(/^[a-z][a-zA-Z_0-9]+$/);

export const validateRescriptVariableName = (str: string): boolean =>
  validReScriptVariableNameRegexp.test(str);
