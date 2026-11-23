"""Construit questions-like revision/<key>.js : HTML du résumé + mots du glossaire surlignés."""
import re, json, sys, html, os

SUBJ = [  # key, fichier html, titre, icône, couleur, UE
 ('endo','Fiches_r_sum_s___Endocrinologie','Endocrinologie','🦋','#a78bfa','Endo-Métabo-Nutri'),
 ('metabo','Fiches_r_sum_s___M_tabolisme','Métabolisme','🍬','#f472b6','Endo-Métabo-Nutri'),
 ('nutri','Nutrition___Fiches_r_sum_s','Nutrition','🥗','#4ade80','Endo-Métabo-Nutri'),
 ('neph','Fiches_r_sum_s___N_phrologie','Néphrologie','🫘','#38bdf8','Uro-Néphro'),
 ('uro','R_sum____Cours_durologie','Urologie','💧','#fbbf24','Uro-Néphro'),
 ('radio','Radiologie___Fiches_r_sum_s','Radiologie','🩻','#94a3b8','Radio'),
 ('mn','Fiches_r_sum____M_decine_nucl_aire','Médecine nucléaire','☢️','#2dd4bf','Radio'),
 ('chirg','Fiches_r_sum_s___Chirurgie_g_n_rale','Chirurgie générale','🔪','#f87171','Chir'),
 ('ortho','Fiches_r_sum_s___Chirurgie_orthop_dique','Chirurgie orthopédique','🦴','#fb923c','Chir'),
 ('plast','Chirurgie_plastique___Fiches_r_sum_s','Chirurgie plastique','🩹','#e879f9','Chir'),
 ('neuro','Neurologie_clinique___Fiches_r_sum_s','Neurologie clinique','🧠','#818cf8','Neuro'),
 ('nchir','Neurochirurgie___Fiches_r_sum_s_express','Neurochirurgie','🪛','#c084fc','Neuro'),
 ('nphys','Neurophysiologie___Fiches_r_sum_s_express','Neurophysiologie','⚡','#facc15','Neuro'),
 ('npsy','Fiche_r_sum____Neuropsychologie','Neuropsychologie','🧩','#22d3ee','Neuro'),
 ('nped','Neurop_diatrie___r_sum__du_cours','Neuropédiatrie','🧸','#fda4af','Neuro'),
]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _read(p, prefix):
    out = []
    if not os.path.exists(p): return out
    for i, line in enumerate(open(p, encoding='utf-8')):
        line = line.rstrip('\n')
        if not line.strip() or line.startswith('#'): continue
        names, d, w = line.split('|')
        out.append({'id': f'{prefix}{i}', 'names': [n.strip() for n in names.split(';') if n.strip()], 'd': d.strip(), 'w': w.strip()})
    return out

def load_terms(key, common=True):
    """glossaire de la matière (une ligne plus bas remplace une ligne plus haut pour le même 1er nom)
    + glossaire commun pour les noms que la matière ne définit pas"""
    own = {}
    for t in _read(f'{ROOT}/terms/{key}.txt', 't'):
        k = t['names'][0]
        if k in own:  # remplacement : garder l'id d'origine, fusionner les noms
            old = own[k]; t['id'] = old['id']; t['names'] = list(dict.fromkeys(old['names'] + t['names']))
        own[k] = t
    out = list(own.values())
    if common:
        taken = {n for t in out for n in t['names']}
        for t in _read(f'{ROOT}/terms/_commun.txt', 'c'):
            t['names'] = [n for n in t['names'] if n not in taken]
            if t['names']: out.append(t)
    return out

def load_exp(key):
    """exp/<key>.txt puis exp/_commun.txt : 'SIGLE|mots développés' (la matière l'emporte)"""
    res = {}
    for f in (f'{ROOT}/exp/_commun.txt', f'{ROOT}/exp/{key}.txt'):
        if not os.path.exists(f): continue
        for line in open(f, encoding='utf-8'):
            line = line.rstrip('\n')
            if not line.strip() or line.startswith('#') or '|' not in line: continue
            a, x = line.split('|', 1)
            if a.strip() and x.strip(): res[a.strip()] = x.strip()
    return res

def load_ctx(key, terms):
    """ctx/<key>.txt : 'section|terme|note' ; section = n° de la partie (h2), * = toutes"""
    p = f'{ROOT}/ctx/{key}.txt'; res = {}
    if not os.path.exists(p): return res
    by = {}
    for t in terms:
        for n in t['names']: by[n] = t['id']; by.setdefault(n.lower(), t['id'])
    for line in open(p, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line.strip() or line.startswith('#'): continue
        sec, term, note = line.split('|', 2)
        tid = by.get(term.strip()) or by.get(term.strip().lower())
        if not tid: print('  ctx inconnu :', key, term); continue
        res[f'{sec.strip()}:{tid}'] = note.strip()
    return res

def is_abbr(n):
    if ' ' in n: return False
    up = sum(ch.isupper() for ch in n)
    return up >= 2 or (up >= 1 and any(ch.isdigit() for ch in n)) or n in ('pH',)

def pattern(n):
    e = re.escape(html.escape(n, quote=False)).replace(r"\'", "['’]").replace("'", "['’]")
    if is_abbr(n):
        return rf'(?<![\w-]){e}(?![\w])'
    return rf'(?<![\w-]){e}(?:s|x|es)?(?![\w])'

def annotate(src, terms):
    alts = []
    for t in terms:
        for n in t['names']:
            alts.append((len(n), n, t))
    alts.sort(key=lambda x: -x[0])
    rx_parts, lookup = [], []
    for k, (_, n, t) in enumerate(alts):
        flags = '' if is_abbr(n) else '(?i:' 
        p = pattern(n)
        cs = is_abbr(n) or any(ch.isupper() for ch in n)   # noms propres / sigles : sensibles à la casse
        rx_parts.append(f'(?P<g{k}>{p})' if cs else f'(?P<g{k}>(?i:{p}))')
        lookup.append(t)
    if not rx_parts: return src, set()
    rx = re.compile('|'.join(rx_parts))
    used_global = set(); used_names = set()
    out, seen, seen_blk, in_head, sec = [], set(), set(), False, 0
    for tok in re.split(r'(<[^>]+>)', src):
        if tok.startswith('<'):
            if re.match(r'<h2>', tok): sec += 1
            if re.match(r'<h[23]>', tok): in_head = True; seen = set()
            elif re.match(r'</h[23]>', tok): in_head = False
            if re.match(r'<(p|li|td|th)\b', tok): seen_blk = set()
            out.append(tok); continue
        if in_head or not tok.strip():
            out.append(tok); continue
        def rep(m):
            k = int(m.lastgroup[1:]); t = lookup[k]
            # T1..T4 suivis d'une taille / d'un stade = classification TNM, pas une hormone ni une séquence IRM
            if re.fullmatch(r'T[0-4][abc]?', m.group(0)) and re.match(r'\s*(?:[≤<>]|&[lg]t;|\d|N\d|M\d)', m.string[m.end():m.end()+8]):
                return m.group(0)
            ab = is_abbr(m.group(0))
            kb = (t['id'], m.group(0)) if ab else t['id']   # sigles : chaque sigle d'une même entrée compte à part (MIP / MPR)
            if (kb in seen_blk) if ab else (t['id'] in seen): return m.group(0)
            seen.add(t['id']); seen_blk.add(kb); used_global.add(t['id']); used_names.add((t['id'], m.group(0)))
            return f'<span class="gl" data-t="{t["id"]}" data-s="{sec}" tabindex="0">{m.group(0)}</span>'
        out.append(rx.sub(rep, tok))
    annotate.used_names = used_names
    return ''.join(out), used_global

def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    index = []
    for key, f, title, icon, color, ue in SUBJ:
        src = open(f'{ROOT}/html/{f}.html', encoding='utf-8').read()
        terms = load_terms(key)
        body, used = annotate(src, terms)
        exp = load_exp(key)
        gl = {}
        for t in terms:
            if t['id'] not in used: continue
            g = {'n': t['names'][0], 'd': t['d'], 'w': t['w']}
            x = {n: exp[n] for n in t['names'] if n in exp}
            if x: g['x'] = x
            gl[t['id']] = g
        ctx = load_ctx(key, terms)
        ctx = {k: v for k, v in ctx.items() if k.split(':')[1] in used}
        toc = [html.unescape(re.sub('<[^>]+>', '', h)) for h in re.findall(r'<h2>(.*?)</h2>', body)]
        # ancres sur les h2
        c = iter(range(1000))
        body = re.sub(r'<h2>', lambda m: f'<h2 id="s{next(c)}">', body)
        data = {'key': key, 'title': title, 'icon': icon, 'color': color, 'ue': ue, 'toc': toc, 'html': body, 'gl': gl, 'ctx': ctx}
        open(f'{outdir}/{key}.js', 'w', encoding='utf-8').write(
            'window.REVISION = window.REVISION || {};\nwindow.REVISION[' + json.dumps(key) + '] = ' + json.dumps(data, ensure_ascii=False) + ';\n')
        index.append({'key': key, 'title': title, 'icon': icon, 'color': color, 'ue': ue, 'nterms': len(gl), 'nsec': len(toc)})
        print(f'{title:25s} termes {len(terms):3d}, utilisés {len(gl):3d}, notes de contexte {len(ctx):4d}, sections {len(toc)}')
    open(f'{outdir}/index.js', 'w', encoding='utf-8').write('window.REVISION_INDEX = ' + json.dumps(index, ensure_ascii=False) + ';\n')

if __name__ == '__main__':
    main(sys.argv[1])
