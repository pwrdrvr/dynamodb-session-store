// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepReplaceDatesWithISOStrings(obj: any): any {
  if (obj instanceof Date) {
    return obj.toISOString();
  } else if (Array.isArray(obj)) {
    return obj.map(deepReplaceDatesWithISOStrings);
  } else if (typeof obj === 'object' && obj !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = deepReplaceDatesWithISOStrings(obj[key]);
      }
    }
    return result;
  } else {
    return obj;
  }
}
