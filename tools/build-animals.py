# Génère src/animals.js : un sprite SVG (symbols "a-<id carte>") à partir des icônes OpenMoji (assets/animals/*.svg,
# CC BY-SA 4.0, https://openmoji.org) plus quelques icônes dessinées à la main pour les animaux absents d'Unicode.
# Usage : python tools/build-animals.py
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'animals')

# id de carte -> (fichier OpenMoji, recolorations {ancienne: nouvelle})
CARDS = {
    1: ('1F40A', {}),                      # crocodile
    3: ('1F41F', {'#61b2e4': '#ef8a6d', '#92d3f5': '#f8b9a3'}),  # saumon (poisson recoloré)
    4: ('1F9A6', {}),                      # loutre
    5: ('1F438', {}),                      # grenouille
    6: ('1F986', {}),                      # canard
    7: ('1F9A9', {}),                      # flamant rose
    8: ('1F98E', {}),                      # gecko (lézard)
    9: ('1F401', {}),                      # musaraigne (souris)
    10: ('1F99A', {}),                     # paon
    11: ('1F43F', {}),                     # écureuil (tamia)
    12: ('1F994', {}),                     # hérisson
    13: ('1F41D', {}),                     # abeille
    14: ('1F43B', {}),                     # ours
    15: ('1F407', {}),                     # lapin
    16: ('E010', {}),                      # ara
    17: ('1F417', {}),                     # sanglier
    18: ('1F428', {}),                     # koala
    19: ('1F43A', {}),                     # loup
    20: ('1F426', {'#a57939': '#2f9fd6', '#6a462f': '#e8873a'}),  # martin-pêcheur (oiseau recoloré)
    21: ('1F427', {}),                     # manchot
    22: ('1F987', {}),                     # chauve-souris
    23: ('1F98A', {}),                     # fennec (renard)
    24: ('1F412', {}),                     # macaque (singe)
    25: ('1F985', {}),                     # bateleur (aigle)
    27: ('1F426-200D-2B1B', {}),           # corbeau (oiseau noir)
    28: ('1F999', {}),                     # alpaga (lama)
    29: ('1F98A', {'#e27022': '#eef3f7', '#d0cfce': '#c9d3dc'}),  # renard polaire (renard blanchi)
    30: ('1F99D', {}),                     # raton laveur
    31: ('1F41E', {}),                     # coccinelle
    32: ('1F406', {'#f4aa41': '#4a4a58', '#fff': '#7a7a8a'}),      # panthère (léopard assombri)
    33: ('1F981', {}),                     # lion
    34: ('1F98B', {}),                     # papillon
    35: ('1FACE', {}),                     # élan (orignal)
    36: ('1F989', {}),                     # hibou
    37: ('1F408', {}),                     # chat
    39: ('1F40F', {}),                     # bélier
    40: ('1F9AB', {}),                     # castor
    42: ('1F422', {}),                     # tortue
}

# Icônes maison (style OpenMoji : aplats + contour noir 2px, boîte 72x72)
CUSTOM = {
    2: '<path fill="#7fa8c9" d="M36 13C48 20 60 30 66 40c-8 3-16 3-22 2-3 6-5 12-8 18-3-6-5-12-8-18-6 1-14 1-22-2 6-10 18-20 30-27z"/>'
       '<path fill="#a9c6dc" d="M36 24c6 5 12 10 16 16-5 1-10 1-16 0-6 1-11 1-16 0 4-6 10-11 16-16z"/>'
       '<path fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M36 13C48 20 60 30 66 40c-8 3-16 3-22 2-3 6-5 12-8 18-3-6-5-12-8-18-6 1-14 1-22-2 6-10 18-20 30-27zM36 60c1 4 4 7 8 8"/>'
       '<circle cx="31" cy="30" r="1.8"/><circle cx="41" cy="30" r="1.8"/>',
    26: '<path d="M46 52c6-2 10 2 9 9" fill="none" stroke="#b8925a" stroke-width="5" stroke-linecap="round"/>'
        '<ellipse cx="36" cy="48" rx="10" ry="15" fill="#d9b273"/><ellipse cx="36" cy="51" rx="5" ry="10" fill="#efd9a8"/>'
        '<circle cx="28" cy="21" r="3.5" fill="#b8925a"/><circle cx="44" cy="21" r="3.5" fill="#b8925a"/><circle cx="36" cy="26" r="9" fill="#d9b273"/>'
        '<ellipse cx="32" cy="26" rx="2.6" ry="3" fill="#3b2a1c"/><ellipse cx="40" cy="26" rx="2.6" ry="3" fill="#3b2a1c"/><circle cx="32.7" cy="25.3" r=".9" fill="#fff"/><circle cx="40.7" cy="25.3" r=".9" fill="#fff"/>'
        '<ellipse cx="36" cy="31" rx="1.6" ry="1.2" fill="#3b2a1c"/>'
        '<path fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M36 35a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM26 48c0-8 4-13 10-13s10 5 10 13-4 15-10 15-10-7-10-15zM46 52c6-2 10 2 9 9M30 43l-4 8M42 43l4 8M25.5 19.5a3.5 3.5 0 1 1 5 4M46.5 19.5a3.5 3.5 0 1 0-5 4"/>',
    38: '<path fill="#fff" d="M22 40c-4-10 4-20 16-18 8 1 14 6 16 14 1 5-2 12-9 14H28c-4 0-6-6-6-10z"/>'
        '<path fill="#3f3f3f" d="M44 45c6-1 12-6 16-12-1 8-6 14-14 17z"/>'
        '<circle cx="52" cy="22" r="6" fill="#fff"/><path fill="#e35d4f" d="M57 22l12 3-12 3z"/>'
        '<path fill="none" stroke="#e35d4f" stroke-width="2.5" stroke-linecap="round" d="M32 50v14M38 50v14"/>'
        '<circle cx="53" cy="20" r="1.4"/>'
        '<path fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M22 40c-4-10 4-20 16-18 8 1 14 6 16 14 1 5-2 12-9 14H28c-4 0-6-6-6-10zM44 45c6-1 12-6 16-12-1 8-6 14-14 17M46 22a6 6 0 1 0 12 0 6 6 0 0 0-12 0zM57 22l12 3-12 3M48 27c-2 3-3 6-3 9"/>',
    41: '<g fill="#a9dcf0" opacity=".92" stroke="#000" stroke-width="2" stroke-linejoin="round"><ellipse cx="22" cy="28" rx="14" ry="6" transform="rotate(-20 22 28)"/><ellipse cx="50" cy="28" rx="14" ry="6" transform="rotate(20 50 28)"/><ellipse cx="24" cy="40" rx="12" ry="5" transform="rotate(15 24 40)"/><ellipse cx="48" cy="40" rx="12" ry="5" transform="rotate(-15 48 40)"/></g>'
        '<path fill="#3aa89b" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M36 22c3 0 4 3 4 6l-2 32c0 2-4 2-4 0l-2-32c0-3 1-6 4-6z"/>'
        '<circle cx="32" cy="19" r="4" fill="#2f6f8f" stroke="#000" stroke-width="2"/><circle cx="40" cy="19" r="4" fill="#2f6f8f" stroke="#000" stroke-width="2"/>',
}

def inner(svg):
    m = re.match(r'\s*<svg[^>]*>(.*)</svg>\s*$', svg, re.S)
    if not m:
        raise SystemExit('svg inattendu')
    return m.group(1)

symbols = []
for cid in sorted(set(CARDS) | set(CUSTOM)):
    if cid in CUSTOM:
        body = CUSTOM[cid]
    else:
        code, recolor = CARDS[cid]
        body = inner(open(os.path.join(SRC, code + '.svg'), encoding='utf-8').read())
        for old, new in recolor.items():
            body = body.replace('fill="' + old + '"', 'fill="' + new + '"')
    symbols.append('<symbol id="a-%d" viewBox="0 0 72 72">%s</symbol>' % (cid, body))

sprite = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' + ''.join(symbols) + '</svg>'
out = ('// Généré par tools/build-animals.py — icônes animaux (OpenMoji, CC BY-SA 4.0, openmoji.org, + icônes maison).\n'
       'const ANIMAL_SPRITE = ' + json.dumps(sprite, ensure_ascii=False) + ';\n'
       "if (typeof module !== 'undefined') module.exports = { ANIMAL_SPRITE };\n"
       "else if (typeof self !== 'undefined') self.ANIMAL_SPRITE = ANIMAL_SPRITE;\n")
open(os.path.join(ROOT, 'src', 'animals.js'), 'w', encoding='utf-8').write(out)
print('src/animals.js :', len(out), 'octets,', len(symbols), 'icônes')
