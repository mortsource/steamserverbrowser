export const constSysfsExpr = (arg: unknown): any => typeof arg === 'string'
    ? { content: arg.endsWith('.json') ? '{"version":"0.0.0"}' : '' }
    : [];
export const findModuleExport = (): undefined => undefined;
export const showContextMenu = (): null => null;
export const Menu = (): null => null;
export const MenuItem = (): null => null;
