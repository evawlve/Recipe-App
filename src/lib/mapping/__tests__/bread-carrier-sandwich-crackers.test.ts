import { isCategoryMismatch } from '../filter-candidates';

describe('bread-carrier sandwich vs cracker sandwiches (C70 S239)', () => {
    describe('mismatch true', () => {
        it.each([
            ['bagel sandwich', 'Mini Bagel Sandwich Crackers', 'Kroger'],
            ['croissant sandwich', 'Croissant Sandwich Crackers', null],
            ['sub sandwich', 'Sub Sandwich Crackers', null],
        ])('%s vs %s', (query, name, brand) => {
            expect(isCategoryMismatch(query, name, brand)).toBe(true);
        });
    });

    describe('prefix match', () => {
        // prefix match (the rule covers a filled bagel sandwich)
        it('bagel sandwich with turkey vs Mini Bagel Sandwich Crackers', () => {
            expect(isCategoryMismatch('bagel sandwich with turkey', 'Mini Bagel Sandwich Crackers', null)).toBe(true);
        });
    });

    describe('mismatch false', () => {
        it.each([
            ['bagel sandwich', 'Bagel Sandwich', null],
            ['bagel sandwich', 'Turkey Bagel Sandwich', undefined],
            // query says cracker: the existing skip keeps the candidate
            ['bagel sandwich crackers', 'Mini Bagel Sandwich Crackers', null],
            // brand cracker sandwiches are never touched
            ['lance peanut butter sandwiches', 'Lance Peanut Butter Sandwich Crackers', null],
            ['austin sandwiches', 'Austin Cheese Crackers Sandwiches', null],
            ['ritz cheese sandwiches', 'Ritz Cracker Sandwiches', null],
            // the rule's query arm never matches this query
            ['peanut butter sandwich crackers', 'Peanut Butter Sandwich Crackers', null],
            // not a bread-carrier phrase: out of scope by design
            ['turkey sandwich', 'Turkey Sandwich Crackers', null],
        ])('%s vs %s', (query, name, brand) => {
            expect(isCategoryMismatch(query, name, brand)).toBe(false);
        });
    });
});
