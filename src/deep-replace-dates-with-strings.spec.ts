import { deepReplaceDatesWithISOStrings } from './deep-replace-dates-with-strings';

describe('deepReplaceDatesWithISOStrings', () => {
  it('should replace Date objects with their ISO string representation', () => {
    const date1 = new Date();
    const date2 = new Date();
    const date3 = new Date();

    const obj = {
      name: 'John',
      created: date1,
      friends: [
        {
          name: 'Jane',
          created: date2,
        },
      ],
      latestLog: {
        time: date3,
        message: 'Hello, world!',
      },
    };

    const result = deepReplaceDatesWithISOStrings(obj);

    expect(result.created).toBe(date1.toISOString());
    expect(result.friends[0].created).toBe(date2.toISOString());
    expect(result.latestLog.time).toBe(date3.toISOString());
    expect(result).toEqual({
      name: 'John',
      created: date1.toISOString(),
      friends: [
        {
          name: 'Jane',
          created: date2.toISOString(),
        },
      ],
      latestLog: {
        time: date3.toISOString(),
        message: 'Hello, world!',
      },
    });
  });

  // Check that original object is unmodified
  it('should not modify the original object', () => {
    const date = new Date();
    const obj = {
      name: 'John',
      created: date,
    };

    deepReplaceDatesWithISOStrings(obj);

    expect(obj.created).toBe(date);
  });
});
