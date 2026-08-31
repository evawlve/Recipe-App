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
 *   1. Tokenise the query into n-grams, longest first. The ceiling is DERIVED
 *      from the longest brand in the lists (MAX_BRAND_NGRAM), not hardcoded.
 *   2. At each size, check the n-gram against the exact brand Set, then against
 *      a canonical alias map that folds possessives, separators and `&`/`and`.
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
    'met-rx', 'nature valley', 'no cow', 'nutri-grain',
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

    // ── Supplement / Energy / Pre-workout / DTC brands (2026 cache-warming) ──
    // Modern sports-nutrition, energy-drink and DTC-protein brands surfaced by
    // the branded-query cache-warming session. Multi-word entries ("alani nu",
    // "gorilla mode", "total war", "ghost energy", "core power") are matched as
    // whole phrases by the longest-first n-gram scan below, so hasDecisiveBrand
    // context fires on them without an adjacent product-form word.
    // NOTE: bare "on" (Optimum Nutrition) is deliberately OMITTED — as a 2-char
    // English preposition it would flag countless non-branded lines; the
    // multi-word "optimum nutrition" above covers the brand safely.
    'alani nu', 'c4', 'celsius', 'gorilla mode', 'bang', 'reign', 'total war',
    'redcon1', 'jocko', 'jocko fuel', 'kaged', 'kaged muscle', 'ghost energy',
    'bloom', 'bloom nutrition', 'ryse', 'bucked up', 'transparent labs',
    'legion', 'muscletech', 'ghost',

    // ── RTD Protein / Functional Beverages ────────────────────
    'premier protein', 'core power', 'fairlife', 'owyn', 'koia', 'iconic',
    'muscle milk', 'isopure',

    // ── Protein Bars / Better-for-you Snacks ──────────────────
    'no cow', 'gomacro', 'aloha', 'rxbar', 'quest', 'barebells', 'built',
    'built bar', 'met-rx', 'power crunch',

    // ── Meat Snacks / Jerky ───────────────────────────────────
    'jack links', 'jack link\'s', 'chomps', 'country archer', 'old trapper',
    'slim jim', 'wilde',

    // ── Frozen Dessert / QSR (branded-query coverage) ─────────
    'halo top', 'talenti', 'jeni\'s', 'jenis', 'raising cane\'s', 'raising canes',
    'canes', 'culver\'s', 'culvers', 'whataburger', 'jack in the box',

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
    'coca-cola', 'pepsi', 'dr pepper', 'sprite', 'mountain dew', '7up', '7-up', 'fanta',
    // Digit-leading brands (see digit-brands.ts for the parser-side qty guard).
    // NOTE: mid-line n-gram detection filters 1-char tokens, so space forms
    // ("7 up", "5 hour energy") rely on the digit-brand prefix check instead.
    '5-hour energy', 'musketeers', 'canada dry', 'schweppes', 'seagrams', 'vernors', 'aw root beer', 'a&w', 'mug root beer', 'barqs', 'fresca', 'squirt', 'crush', 'sunkist', 'welchs', 'ocean spray', 'motts', 'martinelli\'s', 'martinellis', 'langers', 'juicy juice', 'rw knudsen', 'santa cruz organic', 'lakewood', 'pom wonderful', 'naked', 'odwalla', 'suja', 'evolution fresh', 'bolthouse',
    'boar\'s head', 'boars head', 'dietz & watson', 'dietz and watson', 'applegate farms', 'foster farms', 'tyson', 'perdue', 'sanderson farms', 'butterball', 'jennie-o', 'honeysuckle white', 'smithfield', 'hormel', 'jimmy dean', 'johnsonville', 'hillshire farm', 'ball park', 'hebrew national', 'nathan\'s', 'nathans', 'oscar mayer', 'bar-s', 'buddig', 'land o frost', 'carl budding', 'schaller & weber', 'volpi', 'columbus', 'fiorucci', 'creminelli', 'olipop', 'poppi',
    'chobani', 'fage', 'oikos', 'siggis', 'stonyfield', 'dannon', 'yoplait', 'brown cow', 'nancy\'s', 'nancys', 'liberte', 'noosa', 'wallaby', 'kite hill', 'forager project', 'silk', 'almond breeze', 'oatly', 'califia farms', 'planet oat', 'chobani oat', 'elmhurst', 'malk', 'three trees', 'ripple', 'notmilk', 'vital farms', 'pete & gerrys', 'pete and gerrys', 'nellies', 'happy egg', 'handsome brook', 'eggland\'s best', 'egglands best',
    'cava', 'sweetgreen', 'roti', 'nando\'s', 'nandos', 'jollibee', 'halal guys', 'torchy\'s', 'torchys', 'velvet taco', 'hopdoddy', 'freebirds', 'waba grill', 'flame broiler', 'the habit', 'habit burger', 'fatburger', 'fuddruckers', 'johnny rockets', 'baja fresh', 'rubio\'s', 'rubios', 'wahoo\'s', 'wahoos', 'church\'s', 'churchs chicken', 'golden chick', 'bush\'s chicken', 'roy rogers', 'arther treachers', 'long john silvers', 'captain d\'s', 'white castle', 'krystal',
    'ben jerry\'s', 'ben jerrys',

    // ── Sit-down / fast-casual chains ────────────────────────
    // Chains are NOT covered by brand-lexicon.json: that file is built from OFF
    // product counts (>= 50 products), i.e. a packaged-goods corpus. Restaurant
    // vocabulary lives here, and these were simply missing. Every one is a real
    // brand in the FatSecret corpus, not a guess: of the 218 FatSecret brands
    // with >= 20 rows, 36 were absent from BRAND_SET even after canonicalization
    // (re-derive: the psql GROUP BY in the 2026-08-31 Lane A write-off, P3).
    // Rows when added, FatSecret / OFF: jersey mike's 94, cheesecake factory 79,
    // buffalo wild wings 70, texas roadhouse 58, portillo's 38, waffle house 20,
    // first watch 9/3.
    'buffalo wild wings', 'cheesecake factory', 'jersey mike\'s',
    'texas roadhouse', 'waffle house', 'portillo\'s', 'first watch',
    // Short forms testers actually type. The LONG names are already entries
    // ('outback steakhouse', 'carrabba\'s italian grill') and an n-gram scan
    // cannot match a PREFIX of an entry, so the short form needs its own entry.
    // Deliberately NOT generalised to "first token of any multi-word brand":
    // that rule would enter 'texas' and 'kind'.
    'outback', 'carrabba\'s',
    // A bare `dots` (Dot's Pretzels) was winning over Dippin' Dots on the line
    // `dippin dots`, because a 1-gram is all the scan had. Entering the 2-token
    // brand lets longest-first do the arbitration. FS 8 rows / OFF 18 across
    // four spellings, so this is corpus-backed, not a special case.
    'dippin\' dots'
];

// ============================================================
// Build lookup structure (run once at module load)
// ============================================================

/**
 * Data-derived brand lexicon: OFF brands appearing on >= 50 distinct products
 * (built by scripts/build-brand-lexicon.ts). Unioned with the curated
 * KNOWN_BRANDS list so brands the curated list misses — e.g. "ghost" — are
 * still detected without an LLM `isBranded` hint. Precision is guarded at build
 * time by a stoplist + frequency floor so generic food words never slip in.
 */
import brandLexicon from './brand-lexicon.json';
import { matchDigitBrandPrefix } from './digit-brands';

/** Set of all brand names (lowercased, trimmed) for O(1) lookup */
const BRAND_SET = new Set<string>([
    ...KNOWN_BRANDS.map(b => b.toLowerCase().trim()),
    ...(brandLexicon as string[]).map(b => b.toLowerCase().trim()),
]);

/**
 * ONE canonicalization, applied to BOTH the lexicon (at module load) and every
 * query n-gram (at scan time). The symmetry is the point: a one-sided fold lets
 * the two drift apart.
 *
 * Three spelling gaps it closes, measured 2026-08-31 against the chain
 * spellings testers actually type:
 *   - POSSESSIVES. The curated list already ships both spellings BY HAND for
 *     some entries ('nathan\'s', 'nathans'), but 201 of 384 apostrophe entries
 *     never got their twin, so `dennys` / `applebees` / `chilis` were
 *     undetectable. This automates a convention the list already endorses.
 *   - SEPARATORS. `chick-fil-a` and `chick fil a` must reach the same key.
 *   - `&` vs `and`. 67 entries carry `&` ('noodles & company'), and OFF spells
 *     the same brands both ways.
 *
 * IT DELIBERATELY KEEPS SINGLE-LETTER TOKENS, and that is load-bearing. An
 * earlier revision reused the scan's `length > 1` filter here and destroyed
 * brand identity on the lexicon side: `s&w` collapsed to the bare token `and`,
 * `san-j` to `san`, `sunny d` to `sunny`. Measured on the 4,102-line corpus,
 * that flagged `shrimp and grits`, `biscuits and gravy` and `half and half` as
 * branded. Canonical n-grams are therefore built from the UNFILTERED query
 * tokens (`tokensAll` below) so both sides keep their short tokens.
 *
 * FOLD_UNSAFE is a MEASURED exception set, not a guess: a canonical form that
 * collides with an ordinary food word flags unbranded queries. `green's` folds
 * to `greens` and fired on `collard greens`, `micro greens` and `power greens
 * blend`. Re-derive before adding to it by diffing base-vs-branch detection over
 * `sync-docs/a8i-census-2026-08-23/design-2026-08-25/corpus4102.txt` (mobile repo).
 */
const FOLD_UNSAFE = new Set<string>(['greens']);

export function canonicalizeBrandKey(value: string): string {
    return value
        .toLowerCase()
        .replace(/['\u2019`]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[-.\/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Canonical aliases that are not already exact BRAND_SET members, mapped back to
 * the lexicon spelling so `matchedBrand` names the real brand rather than the
 * user's rendering of it. Kept SEPARATE from BRAND_SET so the exact match is
 * still tried first at every n-gram size: a canonical hit can only ADD a
 * detection, never displace one that fires today.
 */
const CANON_BRAND_ALIASES = new Map<string, string>();
/**
 * When two lexicon spellings share a canonical form (`in n out` and `in-n-out`),
 * the one we report is NOT arbitrary. `matchedBrand` is consumed by
 * `candidateMatchesTargetBrand()`, which compares only the FIRST whitespace
 * token of the brand — so reporting `in n out` asks a record named
 * "In-N-Out Burger" to contain the bare token `in`, which it never does. The
 * line is then DECISIVE (the brand is spelled in the query) and UNMATCHABLE at
 * the same time, and `saveValidatedMapping()` refuses the correct pick with
 * `save_rejected:brand_mismatch` — turning a detection miss into a save miss.
 * Measured 2026-08-31: `in n out double double` was the ONLY such case among the
 * 17 chains, and preferring the fewest-token spelling removes it.
 */
const preferForBrandMatch = (a: string, b: string) => {
    const ta = a.split(' ').length, tb = b.split(' ').length;
    return ta !== tb ? (ta < tb ? a : b) : (a.length <= b.length ? a : b);
};
for (const brand of BRAND_SET) {
    const canon = canonicalizeBrandKey(brand);
    // EVERY brand gets a canonical entry, not only the ones whose spelling
    // changes. A brand can be unreachable by the exact pass while being spelled
    // exactly right: `in n out` and `special k` are BRAND_SET members that the
    // `length > 1` filter shreds before the scan sees them. That is the
    // documented "114 of 2,665 lexicon entries are unreachable" gap, and it is
    // the same defect as the 3-gram ceiling — a scan that cannot represent the
    // entry. `length >= 3` keeps a degenerate one-or-two-character canonical
    // form from matching punctuation noise.
    if (canon && canon.length >= 3 && !FOLD_UNSAFE.has(canon)) {
        const held = CANON_BRAND_ALIASES.get(canon);
        CANON_BRAND_ALIASES.set(canon, held ? preferForBrandMatch(held, brand) : brand);
    }
}

/**
 * Longest brand in tokens — DERIVED from the lists, never a magic number. The
 * scan was hardcoded to 3 while 54 entries carry 4-6 tokens, so `jack in the
 * box` could not be seen at all and the scan fell through to the bare token
 * `jumbo`, returning a WRONG brand rather than none.
 */
const MAX_BRAND_NGRAM = Math.max(
    3,
    ...[...BRAND_SET, ...CANON_BRAND_ALIASES.keys()].map(b => b.split(' ').length),
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

    // Digit-leading brand check ("7up", "7 up", "5 hour energy"): the leading-
    // quantity strip below would eat the brand's digits ("7up" → "up"), so
    // these are matched against the raw line first.
    const digitBrand = matchDigitBrandPrefix(rawLine);
    if (digitBrand) {
        return { isBranded: true, matchedBrand: digitBrand };
    }

    // Strip leading qty/unit tokens (numbers, fractions, unit abbreviations)
    // so "1 cup Heinz ketchup" → tokens ["cup", "heinz", "ketchup"].
    // Only a STANDALONE leading number is a quantity — digit-leading name
    // tokens ("7up") must survive to the n-gram scan below.
    const cleaned = rawLine
        .replace(/[⅛¼⅓⅜½⅝⅔¾⅞]/g, '')    // Unicode fractions
        .replace(/^\s*[\d./]+(?:\s+|$)/g, '')  // Leading qty (whole token only)
        .trim();

    const tokens = cleaned
        .toLowerCase()
        .split(/[\s,()[\]{}]+/)
        .filter(t => t.length > 1);

    // The canonical pass keeps single-letter tokens, because a brand can BE one
    // ('special k', 'in-n-out', 'chick-fil-a'). The exact pass keeps its long
    // standing `length > 1` filter so today's matches are byte-identical.
    const tokensAll = cleaned
        .toLowerCase()
        .split(/[\s,()[\]{}]+/)
        .filter(Boolean);

    if (tokens.length === 0 && tokensAll.length === 0) {
        return { isBranded: false, matchedBrand: null };
    }

    // Check 3-grams, 2-grams, 1-grams — LONGEST phrase first so a multi-word
    // brand wins over a bare sub-token that is itself a lexicon entry
    // ("alani nu" over "alani", "kettle brand" over "kettle"). A whole-phrase
    // match is what lets hasDecisiveBrandContext treat the hit as decisive.
    for (let size = MAX_BRAND_NGRAM; size >= 1; size--) {
        for (let i = 0; i <= tokens.length - size; i++) {
            const ngram = tokens.slice(i, i + size).join(' ');
            if (BRAND_SET.has(ngram)) {
                // Recover original-case brand name for logging
                const originalTokens = cleaned.split(/[\s,()[\]{}]+/).filter(t => t.length > 1);
                const matched = originalTokens.slice(i, i + size).join(' ');
                return { isBranded: true, matchedBrand: matched };
            }
        }
        // Canonical alias pass at the SAME size, so longest-phrase-first still
        // holds across both lists. Reports the LEXICON spelling: the caller
        // wants the brand, not the user's rendering of it.
        for (let i = 0; i <= tokensAll.length - size; i++) {
            const alias = CANON_BRAND_ALIASES.get(
                canonicalizeBrandKey(tokensAll.slice(i, i + size).join(' ')),
            );
            if (alias) {
                return { isBranded: true, matchedBrand: alias };
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
