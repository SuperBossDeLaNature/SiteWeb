"""Construit questions/<ue>.js pour MédiDuel à partir des cartes extraites + distracteurs rédigés.
Usage : python3 build.py cards.json[,cards2.json] distractors_dir[,dir2] out.js
- Niveau de difficulté 'd' : 1 si la carte est dans un paquet « Facile » (facile_ids.txt ou cartes de facile.json),
  sinon le niveau noté dans levels/<clé>.txt (2 = moyen, 3 = difficile ; défaut 2).
- Q/R : incluse seulement si ses 3 distracteurs existent (distractors/<Matière>/<Chapitre>.txt, lignes id|d1|d2|d3).
- V/F : toujours incluse (2 boutons).
"""
import json, os, re, sys
from collections import OrderedDict

cards_paths, ddirs, out = sys.argv[1:4]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cards, facile = [], set()
for cp in cards_paths.split(','):
    cs = json.load(open(cp))
    if os.path.basename(cp).startswith('facile'): facile |= {c['id'] for c in cs}
    cards += cs
fid = os.path.join(ROOT, 'facile_ids.txt')
if os.path.exists(fid): facile |= {int(l) for l in open(fid) if l.strip()}
levels = {}
ldir = os.path.join(ROOT, 'levels')
if os.path.isdir(ldir):
    for fn in os.listdir(ldir):
        for l in open(os.path.join(ldir, fn)):
            p = l.strip().split('|')
            if len(p) == 2 and p[1] in ('1', '2', '3'): levels[int(p[0])] = int(p[1])

THEME = {  # matière -> réglages du thème sur le site
    'Endocrinologie': dict(key='endo', icon='🦋', color='#a78bfa'),
    'Métabolisme':    dict(key='metabo', icon='🍬', color='#f472b6'),
    'Nutrition':      dict(key='nutri', icon='🥗', color='#4ade80'),
    'Néphrologie':    dict(key='neph', icon='🫘', color='#38bdf8'),
    'Urologie':       dict(key='uro', icon='💧', color='#fbbf24'),
    'Radiologie':         dict(key='radio', icon='🩻', color='#94a3b8'),
    'Médecine nucléaire': dict(key='mn', icon='☢️', color='#2dd4bf'),
    'Chirurgie générale': dict(key='chirg', icon='🔪', color='#f87171'),
    'Chirurgie orthopédique': dict(key='ortho', icon='🦴', color='#fb923c'),
    'Chirurgie plastique': dict(key='plast', icon='🩹', color='#e879f9'),
    'Neurologie clinique': dict(key='neuro', icon='🧠', color='#818cf8'),
    'Neurochirurgie': dict(key='nchir', icon='🪛', color='#c084fc'),
    'Neurophysiologie': dict(key='nphys', icon='⚡', color='#facc15'),
    'Neuropsychologie': dict(key='npsy', icon='🧩', color='#22d3ee'),
    'Neuropédiatrie': dict(key='nped', icon='🧸', color='#fda4af'),
}

dist = {}
for ddir in ddirs.split(','):
  if not os.path.isdir(ddir): continue
  for mat in os.listdir(ddir):
    for fn in os.listdir(os.path.join(ddir, mat)):
        for line in open(os.path.join(ddir, mat, fn), encoding='utf-8'):
            p = line.rstrip('\n').split('|')
            if len(p) == 4: dist[int(p[0])] = p[1:]

themes = OrderedDict()
missing = 0
for c in cards:
    if c['type'] == 'qr':
        if c['id'] not in dist: missing += 1; continue
        q = {'q': c['q'], 'c': [c['a']] + dist[c['id']]}
    else:
        q = {'q': c['q'], 'vf': c['ans']}
    if c['e']: q['e'] = c['e']
    q['d'] = 1 if c['id'] in facile else levels.get(c['id'], 2)
    th = themes.setdefault(c['mat'], OrderedDict())
    th.setdefault(c['chap'], []).append(q)

js = ['// Généré automatiquement depuis le paquet Anki (tools/build.py) : ne pas éditer à la main.',
      'window.QUIZ_THEMES = window.QUIZ_THEMES || [];']
for mat in [m for m in THEME if m in themes]:
    chaps = themes[mat]
    # Chapitres numérotés : on les remet dans l'ordre du cours (numéro, puis nom)
    if all(re.match(r'^\d', k) for k in chaps):
        chaps = OrderedDict(sorted(chaps.items(), key=lambda kv: (int(re.match(r'^\d+', kv[0]).group(0)), kv[0])))
    t = dict(THEME[mat], name=mat, chapters=list(chaps), questions=[])
    for h, (ch, qs) in enumerate(chaps.items()):
        for q in qs: t['questions'].append({'h': h, **q})
    js.append('window.QUIZ_THEMES.push(' + json.dumps(t, ensure_ascii=False, separators=(',', ':')) + ');')
    from collections import Counter
    print(mat, len(t['questions']), 'questions,', len(chaps), 'chapitres', dict(sorted(Counter(q['d'] for q in t['questions']).items())))
open(out, 'w', encoding='utf-8').write('\n'.join(js) + '\n')
print('Q/R sans distracteurs (pas encore incluses) :', missing)
