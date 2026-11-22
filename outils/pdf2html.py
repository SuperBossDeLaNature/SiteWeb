"""Convertit une fiche PDF (export Claude Docs) en HTML structuré : h2/h3, listes, tableaux, gras."""
import pdfplumber, re, sys, html, json

BUL = {'•', '◦', '▪', '‣', '–', '-'}

def font(ch):
    return ch['fontname'].split('+')[-1]

def esc(s): return html.escape(s, quote=False)

def spans(chars):
    """chars -> html avec <b> pour le semibold"""
    out, cur, buf = [], None, ''
    for c in chars:
        b = 'Semibold' in font(c) or 'Bold' in font(c)
        if b != cur and buf:
            out.append(f'<b>{esc(buf)}</b>' if cur else esc(buf)); buf = ''
        cur = b; buf += c['text']
    if buf: out.append(f'<b>{esc(buf)}</b>' if cur else esc(buf))
    s = ''.join(out)
    s = re.sub(r'</b>(\s*)<b>', r'\1', s)
    s = s.replace('​', '')
    return s

def line_chars(chars):
    # ajoute des espaces quand l'écart entre caractères est grand
    res = []
    prev = None
    for c in sorted(chars, key=lambda c: c['x0']):
        if prev is not None and c['x0'] - prev['x1'] > c['size'] * 0.22 and c['text'] != ' ' and prev['text'] != ' ':
            res.append({**c, 'text': ' '})
        res.append(c); prev = c
    return res

def convert(path):
    pdf = pdfplumber.open(path)
    blocks = []  # (kind, level, html, meta)
    for pno, page in enumerate(pdf.pages):
        bullets = [((c['top'] + c['bottom']) / 2, c['x0']) for c in page.curves if (c['x1'] - c['x0']) < 7 and (c['bottom'] - c['top']) < 7]
        page = page.filter(lambda o: not (o.get('object_type') == 'rect' and o['height'] > 400))
        tables = page.find_tables()
        tb = [t.bbox for t in tables]
        def in_table(c):
            return any(x0 - 1 <= c['x0'] <= x1 + 1 and y0 - 1 <= c['top'] <= y1 + 1 for x0, y0, x1, y1 in tb)
        items = []
        for t in tables:
            rows = []
            for row in t.rows:
                cells = []
                for cell in row.cells:
                    if cell is None: cells.append(''); continue
                    x0, y0, x1, y1 = cell
                    cc = [c for c in page.chars if x0 - .5 <= (c['x0'] + c['x1']) / 2 <= x1 + .5 and y0 - .5 <= (c['top'] + c['bottom']) / 2 <= y1 + .5]
                    # lignes dans la cellule
                    lines = {}
                    for c in cc: lines.setdefault(round(c['top'] / 3), []).append(c)
                    txt = ' '.join(spans(line_chars(v)) for k, v in sorted(lines.items()))
                    cells.append(re.sub(r'\s+', ' ', txt).strip())
                rows.append(cells)
            items.append((t.bbox[1], 'table', rows))
        chars = [c for c in page.chars if not in_table(c)]
        groups = []
        for c in sorted(chars, key=lambda c: (c['top'] + c['bottom']) / 2):
            m = (c['top'] + c['bottom']) / 2
            if groups and abs(m - groups[-1][0]) < 4.5:
                groups[-1][1].append(c)
            else:
                groups.append([m, [c]])
        for m, cs in groups:
            cs = line_chars(cs)
            items.append((min(c['top'] for c in cs), 'line', cs))
        items.sort(key=lambda x: x[0])
        for top, kind, data in items:
            if kind == 'table':
                blocks.append(('table', 0, data, top)); continue
            cs = data
            txt = ''.join(c['text'] for c in cs).replace('​', '').strip()
            if not txt: continue
            sz = max(round(c['size'], 1) for c in cs if c['text'].strip())
            f0 = font([c for c in cs if c['text'].strip()][0])
            if sz <= 9.2: continue                      # en-tête / pied de page
            if re.match(r'^Page \d+ of \d+$', txt): continue
            if re.search(r'\d{4}\s*·\s*@', txt): continue  # date + auteur
            if 'Serif' in f0 and sz >= 20: blocks.append(('h1', 0, esc(txt), top)); continue
            if 'Serif' in f0 and sz >= 15: blocks.append(('h2', 0, esc(txt), top)); continue
            if 'Serif' in f0 and sz >= 13: blocks.append(('h3', 0, esc(txt), top)); continue
            if txt in ('·',): continue
            first = [c for c in cs if c['text'].strip()][0]
            mid = (first['top'] + first['bottom']) / 2
            bl = [bx for by, bx in bullets if abs(by - mid) < 6 and bx < first['x0']]
            if bl:
                while cs and cs[0]['text'] == ' ': cs = cs[1:]
                blocks.append(('li', round(max(bl)), spans(cs), first['x0'], max(c['x1'] for c in cs))); continue
            m = re.match(r'^(\d+[.)])\s', txt)
            if m and first['x0'] > 48:
                nn = len(m.group(1))
                vis = [c for c in cs if c['text'] != ' ']
                tx = vis[nn]['x0'] if len(vis) > nn else first['x0']
                blocks.append(('oli', round(first['x0']), spans(cs), tx, max(c['x1'] for c in cs))); continue
            blocks.append(('p', round(first['x0']), spans(cs), sz, max(c['x1'] for c in cs)))
    return merge(blocks)

def merge(blocks):
    # fusionne les lignes de continuation
    out = []
    for b in blocks:
        kind = b[0]
        if kind == 'table' and out and out[-1][0] == 'table' and b[2] and out[-1][2] and len(b[2][0]) == len(out[-1][2][0]):
            rows = b[2][1:] if b[2][0] == out[-1][2][0] else b[2]
            out[-1] = ('table', 0, out[-1][2] + rows, out[-1][3]); continue
        if kind in ('p',) and out:
            last = out[-1]
            plain = re.sub(r'<[^>]+>', '', b[2]).lstrip()
            lowstart = bool(plain) and (plain[0].islower() or plain[0] in '(«[–-×+=/≥≤<>&' or plain[0].isdigit())
            full = len(last) > 4 and (last[4] > 470 or (lowstart and last[4] > 380))
            if last[0] in ('li', 'oli') and abs(b[1] - last[3]) < 4 and full:
                out[-1] = (last[0], last[1], last[2] + ' ' + b[2], last[3], b[4]); continue
            if last[0] == 'p' and abs(b[1] - last[1]) < 4 and full:
                out[-1] = ('p', last[1], last[2] + ' ' + b[2], last[3], b[4]); continue
        out.append(b)
    return out

def render(blocks):
    h = []
    lis = sorted({b[1] for b in blocks if b[0] == 'li'})
    stack = []  # niveaux ouverts
    def close_to(level):
        while stack and stack[-1] > level:
            h.append('</li></ul>'); stack.pop()
    for b in blocks:
        kind = b[0]
        if kind != 'li':
            close_to(-1)
        if kind == 'h1': continue
        if kind in ('h2', 'h3'): h.append(f'<{kind}>{b[2]}</{kind}>')
        elif kind == 'p':
            t = b[2].strip()
            if re.fullmatch(r'<b>[^<]*</b>\s*:?', t) and len(t) < 90: h.append(f'<p class="lbl">{t}</p>')
            else: h.append(f'<p>{t}</p>')
        elif kind == 'oli': h.append(f'<p class="oli">{b[2]}</p>')
        elif kind == 'table':
            rows = b[2]
            if not rows: continue
            t = ['<div class="rv-tw"><table>']
            t.append('<thead><tr>' + ''.join(f'<th>{c}</th>' for c in rows[0]) + '</tr></thead><tbody>')
            for r in rows[1:]:
                if not any(r): continue
                t.append('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>')
            t.append('</tbody></table></div>')
            h.append(''.join(t))
        elif kind == 'li':
            lvl = b[1]
            if stack and stack[-1] == lvl:
                h.append(f'</li><li>{b[2]}')
            elif stack and stack[-1] > lvl:
                close_to(lvl)
                if stack and stack[-1] == lvl: h.append(f'</li><li>{b[2]}')
                else: h.append(f'<ul><li>{b[2]}'); stack.append(lvl)
            else:
                h.append(f'<ul><li>{b[2]}'); stack.append(lvl)
    close_to(-1)
    s = '\n'.join(h)
    s = re.sub(r'\s+', lambda m: '\n' if '\n' in m.group() else ' ', s)
    s = s.replace(' </b>', '</b> ').replace('<b> ', ' <b>')
    return s

if __name__ == '__main__':
    print(render(convert(sys.argv[1])))
