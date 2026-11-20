"""Construit questions/<ue>.js pour MédiDuel à partir des cartes extraites + distracteurs rédigés.
Usage : python3 build.py cards.json distractors_dir out.js
- Q/R : incluse seulement si ses 3 distracteurs existent (distractors/<Matière>/<Chapitre>.txt, lignes id|d1|d2|d3).
- V/F : toujours incluse (2 boutons).
"""
import json, os, re, sys
from collections import OrderedDict

cards_path, ddir, out = sys.argv[1:4]
cards = json.load(open(cards_path))

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
    print(mat, len(t['questions']), 'questions,', len(chaps), 'chapitres')
open(out, 'w', encoding='utf-8').write('\n'.join(js) + '\n')
print('Q/R sans distracteurs (pas encore incluses) :', missing)
