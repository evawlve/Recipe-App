import { fdcHeadMatchesQuery } from '../fdc-head-match';

describe('fdcHeadMatchesQuery', () => {
    test.each([
        ['raspberry', 'Raspberries, raw', true],
        ['raspberry', 'Raspberry juice concentrate', false],
        ['strawberry', 'Guavas, strawberry, raw', false],
        ['spinach', 'Spinach souffle', false],
        ['spinach', 'Spinach, raw', true],
        ['green beans', 'Beans, snap, green, raw', false],
        ['sweet potato', 'Sweet potato, raw, unprepared', true],
    ])('%s ~ %s -> %s', (query, description, expected) => {
        expect(fdcHeadMatchesQuery(query, description)).toBe(expected);
    });

    test('a missing or non-string description never matches', () => {
        expect(fdcHeadMatchesQuery('raspberry', undefined)).toBe(false);
        expect(fdcHeadMatchesQuery('raspberry', null)).toBe(false);
        expect(fdcHeadMatchesQuery('raspberry', 42)).toBe(false);
    });

    test('an empty query or head never matches', () => {
        expect(fdcHeadMatchesQuery('', 'Raspberries, raw')).toBe(false);
        expect(fdcHeadMatchesQuery('raspberry', ', raw')).toBe(false);
    });
});
