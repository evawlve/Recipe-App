import { displayFdcName } from '../display-fdc-name';

describe('displayFdcName', () => {
  test.each([
    ['Onions, raw', 'Onions, raw'],
    ['Raspberries, raw', 'Raspberries, raw'],
    ['Spices, onion powder', 'Spices, onion powder'],
    ['', ''],
    [
      'HOT POCKETS, CROISSANT POCKETS Chicken, Broccoli, and Cheddar Stuffed Sandwich, frozen',
      'Hot Pockets, CROISSANT POCKETS Chicken, Broccoli, and Cheddar Stuffed Sandwich, frozen',
    ],
    ["CAMPBELL'S, Tomato Soup, condensed", "Campbell's, Tomato Soup, condensed"],
    ['RICE-A-RONI, chicken flavor, unprepared', 'Rice-a-roni, chicken flavor, unprepared'],
    ['Candies, MARS SNACKFOOD US, DOVE Milk Chocolate', 'Candies, Mars Snackfood Us, DOVE Milk Chocolate'],
    ['  onions, raw ', 'Onions, raw'],
  ])('%s', (input, expected) => {
    expect(displayFdcName(input)).toBe(expected);
  });
});
