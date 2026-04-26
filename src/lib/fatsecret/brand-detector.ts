/**
 * Brand Detector
 *
 * Detects branded food queries from a static list of ~500+ known grocery /
 * restaurant / supplement brands.  Called early in the pipeline so the
 * isBranded signal is available even when the LLM normalizer gate is skipped
 * (e.g. high-confidence first-pass, cache hit, or low-confidence ingredients
 * that never reach aiNormalizeIngredient).
 *
 * Detection strategy:
 *   1. Tokenise the query into 1-, 2- and 3-word n-grams.
 *   2. Check each n-gram against a lowercased brand Set.
 *   3. Return true + matched brand name on first hit.
 *
 * Performance: O(tokens) — typically <0.1 ms per call.
 */

// ============================================================
// Brand List
// ============================================================

/**
 * Known grocery, CPG, restaurant, and supplement brands.
 * Keep entries lowercase; multi-word brands use spaces (e.g. "kodiak cakes").
 * Sorted alphabetically within each category for easy maintenance.
 */
const KNOWN_BRANDS: string[] = [
    // ── Yogurt & Dairy-Based ──────────────────────────────────
    'activia', 'brown cow', 'chobani', 'dannon', 'fage', 'green valley',
    'icelandic provisions', 'liberte', 'noosa', 'oikos', 'siggis',
    'stonyfield', 'two good', 'wallaby', 'yoplait',

    // ── Milk & Dairy ─────────────────────────────────────────
    'borden', 'cabot', 'challenge', 'clover', 'darigold', 'dean foods',
    'fairlife', 'garelick', 'hood', 'horizon', 'kerrygold', 'lactaid',
    'land o lakes', 'organic valley', 'promised land', 'shamrock',
    'smiths', 'straus', 'tillamook', 'upstate farms',

    // ── Cheese ───────────────────────────────────────────────
    'alouette', 'babybel', 'belgioioso', 'boar\'s head', 'boursin',
    'castello', 'crystal farms', 'finlandia', 'frigo', 'galbani',
    'heluva good', 'jarlsberg', 'kraft', 'laughing cow', 'leerdammer',
    'maytag', 'meunster', 'nancy\'s', 'parrano', 'polly-o', 'presidente',
    'sargento', 'stella', 'tillamook', 'velveeta',

    // ── Butter & Spreads ─────────────────────────────────────
    'brummel & brown', 'country crock', 'earth balance', 'i can\'t believe it\'s not butter',
    'lurpak', 'miyokos', 'parkay', 'plugra', 'promise', 'smart balance',
    'vital farms', 'western star',

    // ── Cream Cheese & Soft Cheese ───────────────────────────
    'kite hill', 'philadelphia', 'president', 'tofutti',

    // ── Ice Cream & Frozen Desserts ───────────────────────────
    'arctic zero', 'baskin robbins', 'ben & jerry\'s', 'ben & jerrys', 'ben and jerrys',
    'breyers', 'dreyers', 'edy\'s', 'friendly\'s', 'good humor',
    'haagen-dazs', 'haagen dazs', 'halo top', 'klondike', 'magnum',
    'outshine', 'popsicle', 'skinny cow', 'so delicious', 'talenti',
    'turkey hill', 'yasso',

    // ── Eggs ─────────────────────────────────────────────────
    'davidson\'s', 'happy egg', 'incredible egg', 'nellie\'s', 'pete & gerry\'s',
    'vital farms', 'organic valley',

    // ── Meat & Poultry ────────────────────────────────────────
    'al fresco', 'applegate', 'ball park', 'bob evans', 'butterball',
    'dietz & watson', 'eckrich', 'farmer john', 'hebrew national',
    'hillshire farm', 'hormel', 'jennie-o', 'jimmy dean', 'johnsonville',
    'jones dairy', 'kayem', 'kineret', 'klement\'s', 'niman ranch',
    'oscar mayer', 'patrick cudahy', 'perdue', 'sara lee', 'smithfield',
    'state fair', 'tyson', 'usinger\'s',

    // ── Plant-Based & Meat Alternatives ──────────────────────
    'abbot\'s', 'amy\'s', 'beyond burger', 'beyond meat', 'boca',
    'dr praeger\'s', 'field roast', 'gardein', 'good catch',
    'impossible', 'impossible burger', 'impossible foods',
    'lightlife', 'morningstar', 'morningstar farms', 'omni foods',
    'quorn', 'sweet earth', 'tofurky',

    // ── Seafood ───────────────────────────────────────────────
    'bumble bee', 'chicken of the sea', 'gorton\'s', 'king oscar',
    'safe catch', 'season brand', 'starkist', 'wild planet',

    // ── Condiments & Sauces ───────────────────────────────────
    'annie\'s', 'best foods', "briggs & al\'s", 'cholula', 'crystal hot sauce',
    'dan-t\'s', 'duke\'s', 'el yucateco', 'franks redhot', "frank's redhot",
    'french\'s', 'grey poupon', 'gulden\'s', 'heinz', 'hellmanns', "hellmann's",
    'hidden valley', 'huy fong', 'kikkoman', "kraft", 'lea & perrins',
    'lizano', 'louisiana hot sauce', 'marzetti', 'miracle whip',
    'newman\'s own', "newmans own", 'old bay', 'primal kitchen',
    'sir kensington\'s', 'siracha', 'sriracha', 'tabasco', 'texas pete',
    'tony chachere\'s', 'trappey\'s', 'valentina', 'whataburger',
    'worcestershire',

    // ── Pasta Sauces ──────────────────────────────────────────
    'barilla', 'bertolli', 'classico', 'del monte', 'emeril\'s',
    'hunt\'s', 'michael angelo\'s', 'muir glen', 'prego', 'rao\'s',
    'victoria', 'whole foods 365',

    // ── Salsa & Mexican ───────────────────────────────────────
    'chi-chi\'s', 'frontera', 'green mountain gringo', 'herdez',
    'jardine\'s', 'la victoria', 'mateo\'s', 'newman\'s own', 'pace',
    'pioneer woman', 'poblano', 'tostitos',

    // ── Salad Dressing ────────────────────────────────────────
    'annie\'s', 'girard\'s', 'ken\'s', "ken's steakhouse",
    'kraft', 'litehouse', 'marie\'s', 'marzetti', 'newman\'s own',
    'primal kitchen', 'vines', 'wishbone', 'zesty italian',

    // ── Bread & Bakery ────────────────────────────────────────
    'arnold', 'aunt millie\'s', 'dave\'s killer bread', 'daves killer bread',
    'entemann\'s', 'franz', 'julia\'s', 'king\'s hawaiian',
    'la brea bakery', 'lewis bake shop', 'martin\'s', 'mission',
    'nature\'s own', 'natures own', 'oroweat', 'pepperidge farm',
    'roman meal', 'sara lee', 'schmidt', 'stroehmann',
    'thomas\'', 'thomas\'s', 'wonder',

    // ── Tortillas & Wraps ─────────────────────────────────────
    'mission', 'old el paso', 'siete', 'tia rosa', 'toda buena', 'ole',

    // ── Crackers & Snacks ─────────────────────────────────────
    'ak-mak', 'austin', 'back to nature', 'cheez-it', 'crunchmaster',
    'goldfish', 'good thins', 'jan\'s', 'kashi', 'milton\'s',
    'nabisco', 'pepperidge farm', 'pirate\'s booty', 'pirates booty',
    'pita pal', 'pretzel crisps', 'rice thins', 'ritz', 'snyder\'s',
    'stacy\'s', 'suzie\'s', 'team keto', 'triscut', 'triscuit',
    'wasa', 'wheat thins',

    // ── Chips & Crisps ────────────────────────────────────────
    'cape cod', 'cheetos', 'chester\'s', 'deep river', 'doritos',
    'fritos', 'funyuns', 'good health', 'kettle brand', 'kettle chips',
    'lays', "lay's", 'miss vickie\'s', 'miss vickies', 'pirate\'s booty',
    'popchips', 'pringles', 'ruffles', 'siete', 'sun chips', 'sunchips',
    'terra', 'tim\'s', 'tostitos', 'utz', 'wise',

    // ── Cookies & Sweets ──────────────────────────────────────
    'anna\'s', 'back to nature', 'dare', 'famous amos', 'goodthins',
    'keebler', 'lofthouse', 'lu', 'nabisco', 'newman-o\'s', 'nilla',
    'oreo', 'pepperidge farm', 'pillsbury', 'stella d\'oro', 'tate\'s',
    'trader joe\'s',

    // ── Protein Bars & Snack Bars ─────────────────────────────
    'atkins', 'clif', 'cliff bar', 'epic', 'fit crunch', 'fulfil',
    'gatorade', 'greens first', 'kind', 'larabar', 'luna', 'lara bar',
    'met-rx', 'nature valley', 'no cow', 'nutri-grain', 'one bar',
    'perfect bar', 'power crunch', 'pure protein', 'quest', 'rx bar',
    'rxbar', 'ratio', 'skip', 'skyr', 'think thin', 'thinktin',
    'two moms in the raw', 'unreal', 'zone', 'zbar',

    // ── Cereal ───────────────────────────────────────────────
    'barbara\'s', 'cap\'n crunch', 'cascadian farm', 'cheerios',
    'cinnamon toast crunch', 'cocoa puffs', 'cream of wheat', 'fiber one',
    'froot loops', 'frosted flakes', 'frosted mini wheats', 'granola',
    'grape nuts', 'honey bunches of oats', 'honey smacks', 'kashi',
    'kelloggs', "kellogg's", 'life cereal', 'lucky charms', 'malt-o-meal',
    'nature\'s path', 'natures path', 'post', 'quaker', 'raisin bran',
    'rice chex', 'rice krispies', 'special k', 'uncle sam', 'wheaties',

    // ── Oatmeal & Hot Cereal ──────────────────────────────────
    'bob\'s red mill', 'bobs red mill', 'coach\'s oats', 'country choice',
    'cream of wheat', 'nature\'s path', 'old wessex', 'quaker',
    'purely elizabeth',

    // ── Pancake & Baking Mixes ────────────────────────────────
    'arrowhead mills', 'aunt jemima', 'betty crocker', 'bisquick',
    'bob\'s red mill', 'bobs red mill', 'hungry jack', 'kodiak cakes',
    'king arthur', 'krusteaz', 'pillsbury',

    // ── Flour, Sugar & Baking ─────────────────────────────────
    'arrowhead mills', 'bob\'s red mill', 'bobs red mill',
    'domino', 'gold medal', 'king arthur', 'pillsbury', 'robin hood',

    // ── Pasta & Noodles ───────────────────────────────────────
    'ancient harvest', 'barilla', 'banza', 'creamette', 'de cecco',
    'dreamfields', 'delverde', 'eden', 'jovial', 'la molisana',
    'muellers', "mueller's", 'prince', 'ronzoni', 'skinner', 'tinkyada',
    'tolerant', 'wewalka', 'zerega',

    // ── Rice & Grains ─────────────────────────────────────────
    'ben\'s original', 'bens original', 'carolinas', 'goya',
    'lotus foods', 'lundberg', 'mahatma', 'minute rice', 'producers',
    'success rice', 'texmati', 'uncle ben\'s', 'uncle bens',

    // ── Canned Goods & Pantry ─────────────────────────────────
    'amy\'s', 'annie\'s', 'bush\'s', 'bushes', 'campbells', "campbell's",
    'del monte', 'eden', 'goya', 'green giant', 'hunt\'s',
    'libby\'s', 'libbys', 'muir glen', 'pacific foods', 'progresso',
    'red gold', 'rotel', "ro*tel", 's&w', 'sclafani', 'stag', 'trader joe\'s',
    'tuttorosso', 'v8', 'vlasic', 'whole foods 365',

    // ── Frozen Foods ──────────────────────────────────────────
    'alexia', 'amy\'s', 'bird\'s eye', 'birds eye', 'cascadian farm',
    'conagra', 'devour', 'evol', 'feel good foods', 'garden lites',
    'gorton\'s', 'green giant', 'healthy choice', 'kashi', 'lean cuisine',
    'michael angelo\'s', 'morningstar farms', 'ore-ida', 'realgood',
    'seapak', 'saffron road', 'stouffer\'s', 'stouffers',
    'tattooed chef', 'trader joe\'s', 'weight watchers', 'ww',

    // ── Soups & Broths ────────────────────────────────────────
    'campbells', "campbell's", 'college inn', 'imagine', 'kettle & fire',
    'knorr', 'pacific foods', 'progresso', 'swanson', 'wolfgang puck',

    // ── Oils & Vinegars ───────────────────────────────────────
    'bertolli', 'bragg', 'california olive ranch', 'chosen foods',
    'crisco', 'filippo berio', 'kirkland', 'la tourangelle',
    'lucini', 'mazola', 'pam', 'primal kitchen', 'spectrum', 'wesson',

    // ── Nut Butters ───────────────────────────────────────────
    'adams', 'arrowhead mills', 'barney', 'crazy richard\'s', 'justin\'s',
    'jif', 'kirkland', 'maranatha', 'once again', 'peter pan',
    'rxbar', 'santa cruz', 'skippy', 'smucker\'s', 'smuckers',
    'sunbutter', 'wild friends', 'woodstock',

    // ── Sweeteners & Syrups ───────────────────────────────────
    'agave in the raw', 'domino', 'equal', 'hungry jack',
    'lakanto', 'log cabin', 'monk fruit in the raw', 'mrs butterworths',
    'pure via', 'swerve', 'splenda', 'stevia in the raw', 'sue bee',
    'sugar in the raw', 'sweet leaf', 'truvia', 'wholesome',

    // ── Coffee & Tea ─────────────────────────────────────────
    'bigelow', 'black rifle coffee', 'blue bottle', 'bulletproof',
    'califia cold brew', 'celestial seasonings', 'chameleon',
    'chameleon cold brew', 'choice organic teas', 'counter culture',
    'death wish', 'death wish coffee', 'dunkin', 'eight o\'clock',
    'folgers', 'four sigmatic', 'gaia herbs', 'green mountain',
    'harney & sons', 'harney and sons', 'illy', 'intelligentsia',
    'la colombe', 'lavazza', 'lipton', 'maxwell house', 'melitta',
    'mud/wtr', 'mudwtr', 'nescafe', 'nespresso', 'numi organic',
    'numi tea', 'onyx', 'peet\'s', 'republic of tea', 'rishi',
    'ritual coffee', 'sightglass', 'starbucks', 'stash', 'stok',
    'stok cold brew', 'tazo', 'teavana', 'tetley', 'traditional medicinals',
    'tully\'s', 'verve', 'yogi', 'yogi tea',

    // ── Beverages ─────────────────────────────────────────────
    'arizona', 'bai', 'body armor', 'bodyarmor', 'core', 'crystal light',
    'gatorade', 'honest tea', 'liquid iv', 'mio', 'muscle milk',
    'naked juice', 'nuun', 'pedialyte', 'powerade', 'propel',
    'red bull', 'sparkling ice', 'snapple', 'sobe', 'topo chico',
    'tropicana', 'v8', 'vitaminwater',

    // ── Protein Powder & Supplements ──────────────────────────
    'athletic greens', 'ag1', 'amazing grass', 'biosteel', 'body fortress',
    'bsn', 'c4 energy', 'cellucor', 'cellucor c4', 'dymatize', 'garden of life',
    'gaspari', 'gnc', 'gold standard', 'gu energy', 'isopure', 'jarrow', 'kin',
    'klean athlete', 'liquid iv', 'maurten', 'muscle milk', 'muscle pharm',
    'musclepharm', 'myprotein', 'nature\'s best', 'now foods', 'now sports',
    'nutrabolt', 'nutrafol', 'nuun', 'nuun hydration', 'optimum nutrition',
    'orgain', 'pas', 'pedialyte sport', 'precision hydration', 'primal kitchen',
    'promix', 'pure encapsulations', 'pure protein', 'quest nutrition', 'raw organic',
    'ritual', 'ritual vitamins', 'scivation', 'six star', 'skratch labs',
    'sunwarrior', 'thorne', 'vega', 'vega sport', 'vital proteins', 'xtend',

    // ── Specialty / Natural / Organic ─────────────────────────
    '365 everyday value', '365 whole foods', 'ancient harvest', 'annie\'s',
    'applegate', 'arrowhead mills', 'bob\'s red mill', 'bobs red mill',
    'bragg', 'bragg\'s', 'braggs', 'califia', 'cascadian farm', 'clif',
    'daiya', 'eden', 'eden foods', 'eden organic', 'elmhurst', 'enjoy life',
    'epic', 'field day', 'follow your heart', 'forager', 'frontier co-op',
    'frontier coop', 'garden of life', 'go raw', 'good culture', 'good karma',
    'greenwise', 'harvest snaps', 'kite hill', 'larabar', 'lara bar',
    'lily\'s', 'lotus foods', 'lundberg', 'malk', 'mary\'s gone crackers',
    'miyokos', 'muir glen', 'natural value', 'nature\'s path', 'natures path',
    'nature\'s promise', 'natures promise', 'nuttzo', 'o organics', 'oatly',
    'once again', 'organic valley', 'pacific foods', 'private selection',
    'purely elizabeth', 'ripple', 'rx bar', 'rxbar', 'signature select',
    'simple mills', 'simple truth', 'simple truth organic', 'simply organic',
    'so delicious', 'spice islands', 'sprouts brand', 'store brand',
    'sun basket', 'sunbutter', 'sweet earth', 'temple', 'the spice hunter',
    'think', 'three trees', 'trader joe\'s', 'vans', "van's", 'violife',
    'vital farms', 'westsoy', 'wild harvest', 'woodstock', 'woodstock farms',

    // ── Fast Food / Restaurant Brands (common in recipes) ─────
    'arby\'s', 'arbys', 'bojangles', 'burger king', 'carl\'s jr', 'carls jr',
    'checkers', 'chick-fil-a', 'chipotle', 'cook out', 'culver\'s', 'culvers',
    'dairy queen', 'del taco', 'domino\'s', 'dominoes', 'dq', 'el pollo loco',
    'five guys', 'hardee\'s', 'hardees', 'in n out', 'in-n-out', 'jack in the box',
    'kentucky fried chicken', 'kfc', 'little caesars', 'mcdonald\'s', 'mcdonalds',
    'moe\'s', 'moes', 'olive garden', 'panda express', 'panera', 'papa john\'s',
    'papa johns', 'pizza hut', 'popeye\'s', 'popeyes', 'qdoba', 'raising cane\'s',
    'canes', 'rally\'s', 'rallys', 'red lobster', 'shake shack', 'smashburger',
    'sonic', 'starbucks', 'steak n shake', 'subway', 'taco bell', 'wendy\'s',
    'wendys', 'whataburger', 'whole foods', 'wingstop', 'zaxby\'s', 'zaxbys',

    // ── Baby Food ─────────────────────────────────────────────
    'annabel karmel', 'baby mum-mum', 'beech-nut', 'beechnut', 'cerebelly',
    'earth\'s best', 'earths best', 'ella\'s kitchen', 'ellas kitchen',
    'gerber', 'happy baby', 'happy tot', 'heinz baby', 'hipp', 'holle',
    'little spoon', 'mum-mum', 'once upon a', 'organix', 'plum organics',
    'serenity kids', 'sprout', 'sprout organic', 'yumi',

    // ── Chocolate & Confectionery ─────────────────────────────
    'alter eco', 'bark thins', 'brookside', 'divine', 'endangered species',
    'enjoy life', 'ghirardelli', 'godiva', "guittard", "hershey's",
    'hersheys', 'justin\'s', 'lily\'s', 'lindt', 'mast brothers',
    'nestle', 'reese\'s', 'reeses', 'ritter sport', 'scharffen berger',
    'theo', 'tcho', 'valrhona',

    // ── International / Ethnic ────────────────────────────────
    'abc sauce', 'ajinomoto', 'aroy-d', 'badia', 'baxters', 'bibigo',
    'blue dragon', 'bonne maman', 'catch', 'chaokoh', 'cj', 'clearspring',
    'divella', 'don julio', 'eastern', 'embasa', 'everest spice', 'gallo',
    'garofalo', 'golden mountain', 'goya', 'grace', 'haldiram\'s', 'haldirams',
    'hero', 'huy fong', 'inka crops', 'jarritos', 'jumex', 'kame', 'kikkoman',
    'kitchens of india', 'la choy', 'la costena', 'la costeña', 'lee kum kee',
    'lobo', 'loisa', 'mae ploy', 'maesri', 'maggi', 'mama noodles', 'maruchan',
    'maseca', 'maya', 'mdh', 'meridian', 'minsa', 'mirin', 'mother\'s recipe',
    'mothers recipe', 'mtr', 'nissin', 'nongshim', 'ottogi', 'paldo',
    'pantainorasingh', 'patak\'s', 'pataks', 'priya', 'roland', 'rummo', 'samyang',
    'san-j', 'sempio', 'shan', 'st dalfour', 'st. dalfour', 'tamari', 'thai kitchen',
    'veetee', 'walkerswood', 'whole earth', 'wilkin & sons', 'yeo\'s', 'yeos',

    // ── Private Label / Store Brands ──────────────────────────
    'baker\'s corner', 'bakers corner', 'central market', 'countryside creamery',
    'earth grown', 'equate', 'food lion', 'fred meyer', 'friendly farms',
    'good and gather', 'great value', 'h-e-b', 'heb', 'harris teeter',
    'king soopers', 'kirkland', 'kirkland signature', 'live g-free', 'market pantry',
    'member\'s mark', 'members mark', 'nature\'s nectar', 'natures nectar',
    'never any', 'priano', 'publix', 'publix greenwise', 'ralphs', 'sam\'s choice',
    'sams choice', 'simply nature', 'specially selected', 'trader joe\'s',
    'trader joes', 'wegmans', 'whole foods 365',

    // ── Alcohol & Spirits ─────────────────────────────────────
    '19 crimes', 'absolut', 'apothic', 'baileys', 'bailey\'s', 'barefoot',
    'blue moon', 'bud light', 'budweiser', 'captain morgan', 'chateau ste michelle',
    'cointreau', 'coors', 'coors light', 'corona', 'disaronno', 'dogfish head',
    'dos equis', 'frangelico', 'goose island', 'grand marnier', 'grey goose',
    'heineken', 'hennessy', 'jack daniel\'s', 'jack daniels', 'jim beam',
    'jose cuervo', 'josh cellars', 'kahlua', 'kendall-jackson', 'kim crawford',
    'la marca', 'lagunitas', 'maker\'s mark', 'makers mark', 'malibu', 'meiomi',
    'miller lite', 'midori', 'modelo', 'new belgium', 'patron', 'patron tequila',
    'rombauer', 'sam adams', 'samuel adams', 'santa margherita', 'sierra nevada',
    'smirnoff', 'stella artois', 'stone brewing', 'sutter home', 'yellow tail',
    'yellowtail',

    // ── Meal Kit & Prepared Meal Brands ───────────────────────
    'blue apron', 'daily harvest', 'dinnerly', 'every plate', 'everyplate',
    'factor', 'factor 75', 'freshly', 'gobble', 'gousto', 'green chef',
    'hello fresh', 'hellofresh', 'home chef', 'marley spoon', 'purple carrot',
    'sakara', 'splendid spoon', 'sun basket', 'sunbasket',

    // ── Additional Brands for Coverage ────────────────────────
    'kashi go', 'bear naked', 'love crunch', 'magic spoon', 'catalina crunch', 'three wishes', 'barbaras bakery', 'envirokidz', 'jordans', 'mueslix', 'familia', 'weetabix', 'shredded wheat', 'grapenuts', 'chex', 'kix', 'trix', 'golden grahams', 'cinnamon toast crunch', 'french toast crunch', 'apple jacks', 'corn pops', 'crispix', 'cracklin oat bran', 'smart bran', 'all bran',
    'mccormick', 'morton', 'diamond crystal', 'ghirardelli', 'guittard', 'bakers', 'nestle toll house', 'calumet', 'clabber girl', 'rumford', 'argo', 'kingsford', 'c&h', 'c and h', 'wholesome sweeteners', 'florida crystals', 'in the raw', 'madhava', 'lorann', 'nielsen-massey', 'watkins', 'penzeys', 'the spice house', 'burlap & barrel', 'diaspora co', 'spicely', 'simply organic', 'frontier',
    'sweet baby rays', 'stubbs', 'bulls eye', 'kc masterpiece', 'open pit', 'jack daniels bbq', 'famous daves', 'bone suckin', 'g hughes', 'primal kitchen', 'terrapin ridge', 'stonewall kitchen', 'harry & david', 'rothar', 'a1', 'a.1.', 'heinz 57', 'hp sauce', 'pickapeppa', 'daddies', 'branston', 'colmans', 'pommery', 'maille', 'moutarde de meaux', 'zatarains', 'slap ya mama', 'tony chacheres', 'chef paul prudhommes', 'old bay', 'lawrys', 'cavenders', 'mrs dash', 'badia',
    'de cecco', 'garofalo', 'rummo', 'la molisana', 'rustichella', 'segiano', 'montebello', 'bionaturae', 'jovial', 'tinkyada', 'banza', 'explore cuisine', 'cybeles', 'capello\'s', 'rao\'s', 'raos', 'lucini', 'victoria', 'michalels', 'cucina antica', 'mezetta', 'carbone', 'patsys', 'lidia\'s', 'paesana', 'mid\'s', 'mids', 'silver palate', 'don pepino', 'mutti', 'cento', 'tuttorosso', 'red gold', 'pomi', 'san marzano', 'bianco dinapoli', 'muirglen',
    'frito lay', 'cape cod', 'kettle brand', 'zapps', 'utz', 'wise', 'herrs', 'mikesells', 'chifles', 'plant snacks', 'popchips', 'popcorners', 'snack factory', 'pretzel crisps', 'snyders of hanover', 'snyders', 'rolld gold', 'rold gold', 'dot\'s', 'dots pretzels', 'quinn', 'unique pretzels', 'barkthins', 'brownie brittle', 'stacys', 'stacy\'s', 'toufayan', 'joseph\'s', 'mission', 'guerrero', 'la banderita', 'el milagro', 'cabo chips', 'late july', 'rw garcia', 'garden of eatin', 'xochitl',
    'coca-cola', 'pepsi', 'dr pepper', 'sprite', 'mountain dew', '7up', 'fanta', 'canada dry', 'schweppes', 'seagrams', 'vernors', 'aw root beer', 'a&w', 'mug root beer', 'barqs', 'fresca', 'squirt', 'crush', 'sunkist', 'welchs', 'ocean spray', 'motts', 'martinelli\'s', 'martinellis', 'langers', 'juicy juice', 'rw knudsen', 'santa cruz organic', 'lakewood', 'pom wonderful', 'naked', 'odwalla', 'suja', 'evolution fresh', 'bolthouse',
    'boar\'s head', 'boars head', 'dietz & watson', 'dietz and watson', 'applegate farms', 'foster farms', 'tyson', 'perdue', 'sanderson farms', 'butterball', 'jennie-o', 'honeysuckle white', 'smithfield', 'hormel', 'jimmy dean', 'johnsonville', 'hillshire farm', 'ball park', 'hebrew national', 'nathan\'s', 'nathans', 'oscar mayer', 'bar-s', 'buddig', 'land o frost', 'carl budding', 'schaller & weber', 'volpi', 'columbus', 'fiorucci', 'creminelli', 'olipop', 'poppi',
    'chobani', 'fage', 'oikos', 'siggis', 'stonyfield', 'dannon', 'yoplait', 'brown cow', 'nancy\'s', 'nancys', 'liberte', 'noosa', 'wallaby', 'kite hill', 'forager project', 'silk', 'almond breeze', 'oatly', 'califia farms', 'planet oat', 'chobani oat', 'elmhurst', 'malk', 'three trees', 'ripple', 'notmilk', 'vital farms', 'pete & gerrys', 'pete and gerrys', 'nellies', 'happy egg', 'handsome brook', 'eggland\'s best', 'egglands best',
    'cava', 'sweetgreen', 'roti', 'nando\'s', 'nandos', 'jollibee', 'halal guys', 'torchy\'s', 'torchys', 'velvet taco', 'hopdoddy', 'freebirds', 'waba grill', 'flame broiler', 'the habit', 'habit burger', 'fatburger', 'fuddruckers', 'johnny rockets', 'baja fresh', 'rubio\'s', 'rubios', 'wahoo\'s', 'wahoos', 'church\'s', 'churchs chicken', 'golden chick', 'bush\'s chicken', 'roy rogers', 'arther treachers', 'long john silvers', 'captain d\'s', 'white castle', 'krystal',
    'ben jerry\'s', 'ben jerrys'
];

// ============================================================
// Build lookup structure (run once at module load)
// ============================================================

/** Set of all brand names (lowercased, trimmed) for O(1) lookup */
const BRAND_SET = new Set<string>(
    KNOWN_BRANDS.map(b => b.toLowerCase().trim())
);

// ============================================================
// Public API
// ============================================================

export interface BrandDetectionResult {
    isBranded: boolean;
    matchedBrand: string | null;
}

/**
 * Detects whether a raw ingredient line contains a known brand name.
 *
 * Checks 1-, 2-, and 3-word n-grams extracted from the query.
 * Returns on first match (most brands are 1–2 words).
 *
 * @example
 * detectBrandInQuery('1 cup Oikos Triple Zero Vanilla Greek Yogurt')
 * // → { isBranded: true, matchedBrand: 'Oikos' }
 *
 * detectBrandInQuery('2 tbsp olive oil')
 * // → { isBranded: false, matchedBrand: null }
 */
export function detectBrandInQuery(rawLine: string): BrandDetectionResult {
    if (!rawLine || !rawLine.trim()) {
        return { isBranded: false, matchedBrand: null };
    }

    // Strip leading qty/unit tokens (numbers, fractions, unit abbreviations)
    // so "1 cup Heinz ketchup" → tokens ["cup", "heinz", "ketchup"]
    const cleaned = rawLine
        .replace(/[⅛¼⅓⅜½⅝⅔¾⅞]/g, '')    // Unicode fractions
        .replace(/^\s*[\d./]+\s*/g, '')       // Leading qty
        .trim();

    const tokens = cleaned
        .toLowerCase()
        .split(/[\s,()[\]{}]+/)
        .filter(t => t.length > 1);

    if (tokens.length === 0) {
        return { isBranded: false, matchedBrand: null };
    }

    // Check 1-grams, 2-grams, 3-grams
    for (let size = 1; size <= 3; size++) {
        for (let i = 0; i <= tokens.length - size; i++) {
            const ngram = tokens.slice(i, i + size).join(' ');
            if (BRAND_SET.has(ngram)) {
                // Recover original-case brand name for logging
                const originalTokens = cleaned.split(/[\s,()[\]{}]+/).filter(t => t.length > 1);
                const matched = originalTokens.slice(i, i + size).join(' ');
                return { isBranded: true, matchedBrand: matched };
            }
        }
    }

    return { isBranded: false, matchedBrand: null };
}

/**
 * Convenience boolean — use when you only need the flag.
 */
export function isBrandedIngredient(rawLine: string): boolean {
    return detectBrandInQuery(rawLine).isBranded;
}

/**
 * Number of brands in the static list (for logging/debugging).
 */
export const BRAND_LIST_SIZE = BRAND_SET.size;
