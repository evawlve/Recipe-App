const REPLACERS: Array<[RegExp, string]> = [
  [/fat[-\s]?free/gi, 'nonfat'],
  [/non[-\s]?fat/gi, 'nonfat'],
  
  [/part[-\s]?skim/gi, 'part skim'],
  [/\bskim\s*(milk)?\b/gi, 'nonfat'],  // treat skim as nonfat in practice

  [/\b2\s*%|\b2\s*percent/gi, '2%'],
  [/\b1\s*%|\b1\s*percent/gi, '1%'],

  [/yoghurt/gi, 'yogurt'],  // UK/US
];

export function normalizeQuery(q: string) {
  let s = q.toLowerCase();
  for (const [re, rep] of REPLACERS) s = s.replace(re, rep);
  s = s.replace(/[^\w\s%]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

export function tokens(q: string) {
  return normalizeQuery(q).split(' ').filter(Boolean).slice(0, 8);
}
