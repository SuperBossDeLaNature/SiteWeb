"""Extrait les cartes Endo-Métabo-Nutri du paquet Anki (col.db) en JSON propre.
Usage : python3 extract.py col.db out.json [ue]   (ue : endo | uro | radio | chir | neuro, défaut endo)
"""
import sqlite3, json, re, html, sys

db, out = sys.argv[1], sys.argv[2]
c = sqlite3.connect(db)
c.create_collation('unicase', lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()))

UES = {  # sous-paquet (niveau matière) -> nom affiché, par UE
    'endo': {'Endocrinologie – Difficile': 'Endocrinologie', 'Nutrition — Difficile': 'Nutrition', 'Métabolisme': 'Métabolisme'},
    'uro': {'Néphro ULB – Difficile': 'Néphrologie', 'Urologie – Difficile': 'Urologie'},
    'chir': {'Chir plastique · Difficile': 'Chirurgie plastique', 'Chirurgie générale (Difficile)': 'Chirurgie générale', 'Chirurgie orthopédique (Difficile)': 'Chirurgie orthopédique'},
    'neuro': {'Neurochirurgie — Difficile': 'Neurochirurgie', 'Neurologie clinique — Difficile': 'Neurologie clinique', 'Neurophysio Difficile': 'Neurophysiologie', 'Neuropsychologie — Difficile': 'Neuropsychologie', 'Neuropédiatrie--Difficile': 'Neuropédiatrie'},
    'radio': {'Médecine nucléaire — Difficile': 'Médecine nucléaire', 'Radiologie · Difficile': 'Radiologie'},
    # paquets « Facile » (niveau 1 sur le site) ; Métabolisme n'existe qu'ici et est déjà pris par 'endo'
    'facile': {'Endocrinologie – Facile': 'Endocrinologie', 'Nutrition — Facile': 'Nutrition',
               'Néphro ULB – Facile': 'Néphrologie', 'Urologie – Facile': 'Urologie',
               'Médecine nucléaire — Facile': 'Médecine nucléaire', 'Radiologie · Facile': 'Radiologie',
               'Chir plastique · Facile': 'Chirurgie plastique', 'Chirurgie générale (Facile)': 'Chirurgie générale',
               'Chirurgie orthopédique (Facile)': 'Chirurgie orthopédique',
               'Neurochirurgie — Facile': 'Neurochirurgie', 'Neurologie clinique — Facile': 'Neurologie clinique',
               'Neurophysio Facile': 'Neurophysiologie', 'Neuropsychologie — Facile': 'Neuropsychologie',
               'Neuropédiatrie --Facile': 'Neuropédiatrie'},
}
TAGCHAP = {  # paquets sans sous-paquets -> chapitre selon le tag
    'Neuropédiatrie--Difficile': {
        'Démarche___développement_du_SNC': '1. Développement du SNC',
        'Ex__1___AVC_in_utero': '2. AVC in utero et hémiplégie',
        'Ex__2___Grand_prématuré': '3. Grand prématuré et IMC',
        'Ex__3___Leucodystrophie': '4. Leucodystrophie métachromatique',
        'Ex__4___Duchenne': '5. Duchenne et Becker',
        'Épilepsie__West': '6. Épilepsie (West, POCS, STB)',
    },
}
TAGCHAP['Neuropédiatrie --Facile'] = TAGCHAP['Neuropédiatrie--Difficile']
KEEP = UES[sys.argv[3] if len(sys.argv) > 3 else 'endo']

def clean(s):
    s = re.sub(r'<br\s*/?>', ' ', s or '')
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', s).strip()

def verdict(v):
    v = clean(v).lower()
    if not v: return None
    if 'faux' in v: return False
    if 'vrai' in v: return True
    return None

decks = {i: n.split('\x1f') for i, n in c.execute('select id,name from decks')}
fields = {}
for nt, o, n in c.execute('select ntid,ord,name from fields order by ntid,ord'):
    fields.setdefault(nt, []).append(n)

rows = []
for nid, mid, flds, tags, did in c.execute(
        'select n.id,n.mid,n.flds,n.tags,c.did from notes n join cards c on c.nid=n.id order by c.did, n.id'):
    p = decks[did]
    if len(p) < 5 or p[4] not in KEEP or (len(p) < 6 and p[4] not in TAGCHAP):
        continue
    f = dict(zip(fields[mid], flds.split('\x1f')))
    q = clean(f.get('Question') or f.get('Recto'))
    a = clean(f.get('Reponse') or f.get('Réponse') or f.get('Verso'))
    expl = clean(f.get('Explication') or f.get('Note') or f.get('Detail') or f.get('Correction') or '')
    vf = verdict(f.get('Verdict') or f.get('VF') or '')
    # Variantes : drapeau VF = "1" (Urologie) ou question préfixée « Vrai ou faux ? » (Néphro) -> verdict dans la réponse
    if vf is None and (clean(f.get('VF') or '') == '1' or re.match(r'(?i)vrai ou faux', q)):
        vf = verdict(a.split('.')[0] if a else '')
        if vf is not None:
            q = re.sub(r'(?i)^vrai ou faux\s*\?\s*', '', q)
            a = re.sub(r'(?i)^[✘✔✓✗\s]*(vrai|faux)\s*[.:!–-]*\s*', '', a)
    if len(p) == 5:  # paquet sans sous-paquets : chapitre lu dans les tags
        chap = next((v for k, v in TAGCHAP[p[4]].items() if k in tags), 'Divers')
    else:
        chap = p[5]
    if len(p) > 6:  # sous-chapitre (ex. MN > 3. Démarches diagnostiques > 01. Ostéo-articulaire)
        chap = re.match(r'^\d+', p[5]).group(0) + '. Démarches · ' + re.sub(r'^\d+\.\s*', '', p[6])
    rec = {'id': nid, 'mat': KEEP[p[4]], 'chap': chap, 'q': q}
    if vf is not None:
        rec.update(type='vf', ans=vf, e=(a if a.lower().strip('. ') not in ('vrai', 'faux') else '') + ((' ' + expl) if expl else ''))
        rec['e'] = rec['e'].strip()
    else:
        rec.update(type='qr', a=a, e=expl)
    rows.append(rec)

json.dump(rows, open(out, 'w'), ensure_ascii=False, indent=0)
from collections import Counter
cnt = Counter((r['mat'], r['chap'], r['type']) for r in rows)
for k, v in sorted(cnt.items()): print(v, *k, sep='\t')
print('total', len(rows))
