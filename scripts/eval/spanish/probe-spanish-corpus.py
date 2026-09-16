"""Probe the Spanish corpus against a live parse route: one POST per line per draw,
`nosave=1&nocache=1&debug=1`, with DEV_API_KEY from the environment.

Environment (every override is optional). The defaults reproduce the 2026-09-12 baseline run's
REQUESTS; the output file differs in shape from that run's, because each record carries `draw`.
  PARSE_BASE      origin to probe, default the box `http://192.168.1.133:3000`; point it at a
                  locally served build (e.g. `http://localhost:3005`) for a two-arm comparison.
                  Must be a bare origin: http or https, a host, an optional port, and no path
                  (a trailing `/` is allowed), query or fragment. Anything else exits 2 before
                  any request is sent.
  SPANISH_CORPUS  corpus JSON, default `spanish-corpus-2026-09-12.json` beside this script
  SPANISH_OUT     results JSON, default `spanish-probe-<timestamp>.json` in the system temp dir
                  (`tempfile.gettempdir()`), printed at start and end. Not beside this script:
                  that tree is Syncthing-mirrored to the box and the file is not gitignored.
  SPANISH_DRAWS   draws per line, default 1. `nocache=1` bypasses SegmentationCache at the route,
                  so every draw is a fresh segmentation; each record carries its `draw` number
"""
import json, os, subprocess, sys, tempfile, time, urllib.parse
HERE=os.path.dirname(os.path.abspath(__file__))


def parse_origin(raw):
    """Return PARSE_BASE as `scheme://host[:port]`, or raise ValueError saying why it is not one."""
    if any(ch.isspace() for ch in raw):
        raise ValueError('contains whitespace')
    u = urllib.parse.urlsplit(raw)
    if u.scheme not in ('http', 'https'):
        raise ValueError(f'scheme must be http or https, got {u.scheme!r}')
    if u.username is not None or u.password is not None:
        raise ValueError('must not carry credentials')
    if not u.hostname:
        raise ValueError('no host')
    try:
        u.port  # raises ValueError on a non-numeric or out-of-range port
    except ValueError:
        raise ValueError(f'invalid port in {u.netloc!r}') from None
    if u.netloc.endswith(':'):
        raise ValueError(f'empty port in {u.netloc!r}')
    if u.path not in ('', '/'):
        raise ValueError(f'must not carry a path, got {u.path!r}')
    if u.query or u.fragment or '?' in raw or '#' in raw:
        raise ValueError('must not carry a query or fragment')
    return f'{u.scheme}://{u.netloc}'


def main():
    raw_base=os.environ.get('PARSE_BASE','http://192.168.1.133:3000')
    try:
        ORIGIN=parse_origin(raw_base)
    except ValueError as e:
        print(f'PARSE_BASE={raw_base!r} is not a bare http(s) origin: {e}', file=sys.stderr)
        sys.exit(2)
    KEY=os.environ['DEV_API_KEY']
    BASE=f'{ORIGIN}/api/nlp/parse?nosave=1&nocache=1&debug=1'
    CORPUS=os.environ.get('SPANISH_CORPUS',os.path.join(HERE,'spanish-corpus-2026-09-12.json'))
    OUT=os.environ.get('SPANISH_OUT') or os.path.join(
        tempfile.gettempdir(), f"spanish-probe-{time.strftime('%Y%m%dT%H%M%S')}.json")
    DRAWS=int(os.environ.get('SPANISH_DRAWS','1'))
    cases=json.load(open(CORPUS))['cases']
    print('BASE',BASE,'DRAWS',DRAWS,'CASES',len(cases))
    print('OUT',OUT)
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


if __name__ == '__main__':
    main()
