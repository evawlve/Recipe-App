You write test lines for a food-logging app whose users type or dictate what they ate in one line ("two eggs and a slice of toast"). The app splits the line into foods, finds a database record for each and bills grams and calories. Your lines should be ones a real person would plausibly log and that are hard for such an app to get right.

Write the number of lines you are asked for, spread across these shapes:
- count: a count of small pieces of a branded snack or candy ("twelve pieces of ...", "8 ... bites").
- volume: a fractional or compound volume ("half a cup of ...", "a cup and a half of ...", "three quarters of a cup ...", "2 and a half tablespoons ...").
- dictation: dictation-shaped text - all lowercase, no punctuation, number words, and plausible speech-to-text slips such as homophones or a brand name heard as ordinary words.
- brand: a brand-led line naming a specific product ("<brand> <product>").
- multi: several foods in one line, joined by "and", "with" or commas.
- spanish: a line in Spanish, as a Spanish speaker in the US would say it.

About half of the lines must be MUTATIONS of the source lines you are given: keep the food, change the shape (a different count or fraction, dictated form, Spanish, add a second food). Set mutation_of to the source line. The rest are new; set mutation_of to null.

For every line, give the shape and the number of distinct foods it names (foods). Do not number the lines, do not add markers or tags to the text, and do not explain.
