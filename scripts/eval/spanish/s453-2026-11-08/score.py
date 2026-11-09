import csv,glob,json,collections,os,sys
D='/Users/diego/dev/snapshots/s453/a2'
def load(arm):
    c=collections.defaultdict(list); nulls=0
    for f in glob.glob(f'{D}/{arm}-labels-*.tsv'):
        for r in csv.DictReader(open(f),delimiter='\t',quoting=csv.QUOTE_NONE):
            if r['status']=='null': nulls+=1
            c[(r['line'],r['truth'])].append(int(r['itemCount']))
    return c,nulls
ONE3=lambda c,l: c[l]
two=['pollo y arroz','una manzana y un platano','huevos y frijoles','cafe y pan dulce']
con=['arroz con frijoles','pan con mantequilla','pan tostado con mantequilla','cereal con leche','tres tortillas de maiz con frijoles','pollo con arroz','pan con tomate']
noex=['pan tostado con mantequilla','tres tortillas de maiz con frijoles','pollo con arroz','pan con tomate']
rec=['huevos con jamon','fresas con crema','papas con huevo','huevos con chorizo','un vaso de leche con chocolate y 3 galletas marias','2 huevos revueltos con una tortilla de maiz']
out=[]
for arm in ['master','V1','V2','V3']:
    c,n=load(arm); by={}
    for (l,t),v in c.items(): by[l]=(t,v)
    P=lambda s:out.append(s)
    P(f'## {arm} (nulls={n})')
    ones=[(l,v) for l,(t,v) in by.items() if t=='1']
    # brief: fresas con crema is AMB in all files -> exclude from the 1-rule but show
    amb1={'fresas con crema'}
    ok1=all(all(x==1 for x in v) and len(v)>=1 for l,v in ones if l not in amb1)
    P(f'gradedItems=1 lines: {[(l,v) for l,v in ones]}')
    P(f'RULE1 all 1-lines =1 on all draws (fresas con crema excluded as AMB): {ok1}')
    ok2=all(by[l][1].count(2)==3 for l in two); P(f'RULE2 {[(l,by[l][1]) for l in two]} -> {ok2}')
    ok3=by['carne asada con arroz y frijoles'][1].count(3)==3; P(f'RULE3 carne asada {by["carne asada con arroz y frijoles"][1]} -> {ok3}')
    hits=[l for l in con if by[l][1].count(2)>=2]; ok4=len(hits)>=5
    P(f'RULE4 con targets {[(l,by[l][1]) for l in con]} hits={len(hits)} -> {ok4}')
    ok5=True
    if arm=='V2':
        h=[l for l in noex if by[l][1].count(2)>=2]; ok5=len(h)>=3; P(f'RULE5 V2 non-example targets hits={len(h)} -> {ok5}')
    P(f'recorded: {[(l,by[l][1]) for l in rec if l in by]}')
    P(f'VERDICT {arm}: {"PASS" if ok1 and ok2 and ok3 and ok4 and ok5 else "FAIL"}\n')
open(f'{D}/scored.md','w').write('\n'.join(out)); print('\n'.join(out))
