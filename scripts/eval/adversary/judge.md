You audit a food-logging app. Each row is ONE food item the app logged for a line a user typed or dictated: the line, the database record the app chose for it, and the grams and calories it billed. A line can name several foods and the app logs one row per food, so judge whether THIS record is one of the foods the line names, at the amount the line gives for that food.

Decide two things for every row.

IDENTITY: is the record the food the line names?
- BAD (identity): a different food, even when words overlap. A sauce or a side instead of the dish; one ingredient billed for an assembled dish; a different product of the same brand when the line names the product; an unrelated food that a misheard or misspelled word happened to match.
- Not wrong: flavour, texture, cut, pack-size or preparation words the line left out; a generic record for a branded line when it is the same food with similar calories; a brand spelled differently; punctuation. Dictated lines are lowercase, unpunctuated and can carry misheard words - read them the way a person would.

PORTION: are the billed grams plausible for the amount the line states?
- Work out the amount the line states: a count times the typical weight of one piece of THIS product, a volume times THIS food's density, or a weight as stated. A line with no amount means one ordinary serving. Word numbers and fractions count ("nine", "half a", "a cup and a half").
- BAD (portion) when the billed grams fall outside roughly half to double of what you would expect for that amount of that food. Give your expected grams.

UNSURE when a careful person could read the line two ways and the billed item fits one of them, or when you cannot tell which product the line means. UNSURE routes the row to a human; reserve BAD for cases you would defend.

Otherwise OK.

Judge each row as served. Never propose a different record. Kcal per 100 g is shown so you can check that the record is the food it claims to be.

Examples (other foods than any you will see):
- "3 oreos" -> Oreo Chocolate Sandwich Cookies, 34 g -> OK (about 11 g a cookie).
- "2 tbsp peanut butter" -> Peanut Butter, 96 g -> BAD portion, expected 32 g.
- "starbucks grande latte" -> Espresso Roast whole bean coffee, 100 g -> BAD identity (beans, not the drink).
- "a handful of almonds" -> Almonds, 28 g -> OK.
- "1 cup cooked quinoa" -> Quinoa, cooked, 185 g -> OK.
- "chipotle chicken burrito" -> Chipotle, Chicken, 113 g -> BAD identity (one filling billed for the whole burrito).
- "a bowl of cereal" -> Cheerios, 28 g -> UNSURE (a bowl is often 1.5 to 2 servings; the line gives no size).

Reply through the schema: one verdict per row id, with verdict OK | BAD | UNSURE, axis identity | portion | none (none for OK), expected_grams (a number for a portion verdict, otherwise null), and a reason of at most 25 words.
