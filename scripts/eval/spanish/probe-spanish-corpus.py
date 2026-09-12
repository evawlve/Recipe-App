import json, os, subprocess, sys, time
SP='/private/tmp/claude-501/-Users-diego-dev-KindaHealthyMobile/b3ba23b6-3d31-4c99-9a1a-e77ca2b55da9/scratchpad/es'
KEY=os.environ['DEV_API_KEY']
BASE='http://192.168.1.133:3000/api/nlp/parse?nosave=1&nocache=1&debug=1'
cases=json.load(open(f'{SP}/spanish-corpus-2026-09-12.json'))['cases']
out=[]
for n,c in enumerate(cases,1):
    body=json.dumps({"text":c["rawText"]})
    r=subprocess.run(['curl','-s','-X','POST',BASE,'-H',f'x-api-key: {KEY}',
                      '-H','content-type: application/json','-d',body],
                     capture_output=True,text=True,timeout=120)
    try: d=json.loads(r.stdout)
    except Exception as e:
        out.append({**c,"error":f"{e}: {r.stdout[:200]}"}); print(n,c['id'],'PARSE-ERR'); continue
    items = d if isinstance(d,list) else (d.get('items') or [])
    rec=[]
    for it in items:
        if not isinstance(it,dict): continue
        nut=it.get('nutrition') or {}
        rec.append({k:it.get(k) for k in
                    ('foodId','foodName','name','brandName','grams','source','servingTier','cacheHit','confidence','portionProvenance')}
                   | {'kcal':nut.get('calories'),'protein':nut.get('protein'),'carbs':nut.get('carbs'),'fat':nut.get('fat')})
    out.append({**c,"items":rec,"nItems":len(rec)})
    print(n,c['id'],c['rawText'],'->',len(rec),'item(s)', [ (x['foodId'], x['grams'], x['kcal']) for x in rec ])
    sys.stdout.flush()
    time.sleep(0.4)
json.dump(out,open(f'{SP}/results.json','w'),indent=1,ensure_ascii=False)
print("WROTE", f'{SP}/results.json')
