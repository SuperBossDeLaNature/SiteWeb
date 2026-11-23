"""Aide à la rédaction : abréviations manquantes avec contexte, définitions courtes, paires (partie, terme) à annoter."""
import re,sys,html,os
sys.path.insert(0,os.path.dirname(__file__))
from build_rev import SUBJ, load_terms, annotate, ROOT
ABR=re.compile(r"(?<![\w-])(?:[A-Z][A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*|[a-z]{1,2}[A-Z]{2,}[a-z0-9]*|Ig[AGMDE]|pH|Hb[A-Za-z0-9]+|[αβ]\d?-?[A-Za-z0-9]+)(?:-[A-Z0-9]+)*(?![\w])")
ROM={'II','III','IV','VI','VII','VIII','IX','XI','XII','XIII','XIV','XV','XX','XXI','OK'}
key,mode=sys.argv[1],sys.argv[2]
f=[x for x in SUBJ if x[0]==key][0][1]
src=open(f'{ROOT}/html/{f}.html').read()
def sent(txt,i,j,w=110):
    a=max(0,i-w); b=min(len(txt),j+w)
    return txt[a:b].replace('\n',' ')
if mode=='miss':
    txt=html.unescape(re.sub('<[^>]+>',' ',src)); txt=re.sub(r'\s+',' ',txt)
    names={n for t in load_terms(key) for n in t['names']}
    done=set()
    for m in ABR.finditer(txt):
        k=m.group(0)
        if k in names or k in ROM or k in done: continue
        done.add(k); print(f'{k} :: {sent(txt,m.start(),m.end(),70)}')
elif mode=='short':
    for t in load_terms(key,common=False):
        if len(t['d'].split())<22: print(';'.join(t['names']),'|',t['d'])
elif mode=='pairs':
    terms=load_terms(key)
    body,_=annotate(src,terms)
    byid={t['id']:t for t in terms}
    txt=body; seen=set()
    plain=lambda s: re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>','',s)))
    for m in re.finditer(r'<span class="gl" data-t="(\w+)" data-s="(\d+)"[^>]*>(.*?)</span>',txt):
        k=(m.group(2),m.group(1))
        if k in seen: continue
        seen.add(k)
        # phrase : depuis le début du bloc
        a=max(txt.rfind('<p',0,m.start()),txt.rfind('<li',0,m.start()),txt.rfind('<tr',0,m.start()))
        b=min([x for x in (txt.find('</p>',m.end()),txt.find('</li>',m.end()),txt.find('<ul',m.end()),txt.find('</tr>',m.end())) if x>0] or [m.end()+300])
        ctx=plain(txt[a:m.start()])[-140:]+'【'+plain(m.group(3))+'】'+plain(txt[m.end():b])[:120]
        print(f'{m.group(2)}|{byid[m.group(1)]["names"][0]}|{ctx}')
