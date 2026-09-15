"""Probe the Spanish corpus against a live parse route: one POST per line per draw,
`nosave=1&nocache=1&debug=1`, with DEV_API_KEY from the environment.

Environment (every override is optional; the defaults reproduce the 2026-09-12 baseline run):
  PARSE_BASE      origin to probe, default the box `http://192.168.1.133:3000`; point it at a
                  locally served build (e.g. `http://localhost:3005`) for a two-arm comparison
  SPANISH_CORPUS  corpus JSON, default `spanish-corpus-2026-09-12.json` beside this script
  SPANISH_OUT     results JSON, default `results.json` beside this script
  SPANISH_DRAWS   draws per line, default 1. `nocache=1` bypasses SegmentationCache at the route,
                  so every draw is a fresh segmentation; each record carries its `draw` number
"""
import json, os, subprocess, sys, time
HERE=os.path.dirname(os.path.abspath(__file__))
KEY=os.environ['DEV_API_KEY']
ORIGIN=os.environ.get('PARSE_BASE','http://192.168.1.133:3000').rstrip('/')
BASE=f'{ORIGIN}/api/nlp/parse?nosave=1&nocache=1&debug=1'
CORPUS=os.environ.get('SPANISH_CORPUS',os.path.join(HERE,'spanish-corpus-2026-09-12.json'))
OUT=os.environ.get('SPANISH_OUT',os.path.join(HERE,'results.json'))
DRAWS=int(os.environ.get('SPANISH_DRAWS','1'))
cases=json.load(open(CORPUS))['cases']
print('BASE',BASE,'DRAWS',DRAWS,'CASES',len(cases))
out=[]
for n,c in enumerate(cases,1):
    for draw in range(1,DRAWS+1):
        body=json.dumps({"text":c["rawText"]})
        r=subprocess.run(['curl','-s','-X','POST',BASE,'-H',f'x-api-key: {KEY}',
                          '-H','content-type: application/json','-d',body],
                         capture_output=True,text=True,timeout=120)
        try: d=json.loads(r.stdout)
        except Exception as e:
            out.append({**c,"draw":draw,"error":f"{e}: {r.stdout[:200]}"}); print(n,c['id'],draw,'PARSE-ERR'); continue
        items = d if isinstance(d,list) else (d.get('items') or [])
        rec=[]
        for it in items:
            if not isinstance(it,dict): continue
            nut=it.get('nutrition') or {}
            rec.append({k:it.get(k) for k in
                        ('foodId','foodName','name','brandName','grams','source','servingTier','cacheHit','confidence','portionProvenance')}
                       | {'kcal':nut.get('calories'),'protein':nut.get('protein'),'carbs':nut.get('carbs'),'fat':nut.get('fat')})
        out.append({**c,"draw":draw,"items":rec,"nItems":len(rec)})
        print(n,c['id'],draw,c['rawText'],'->',len(rec),'item(s)', [ (x['foodId'], x['grams'], x['kcal']) for x in rec ])
        sys.stdout.flush()
        time.sleep(0.4)
json.dump(out,open(OUT,'w'),indent=1,ensure_ascii=False)
print("WROTE", OUT)
